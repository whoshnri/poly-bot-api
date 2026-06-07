import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import prisma from "../../db/prisma";
import {
  failedEstimate,
  filterOpportunities,
  normalizeMarketFromGamma,
  parseAIEstimateFromModel,
  scoreMarkets,
  type AIEstimate,
  type NormalizedMarket,
  type ScoredMarket,
  type SessionScoringState,
} from "../../lib/scoring";
import { getMarketById } from "../../polymarket";
import { getResearchCookie } from "../../session/researchCookie";
import {
  AwaitingFeedbackError,
  createPendingFeedback,
  savePendingFeedback,
} from "../../session/feedback";
import { getSessionWorkflow, updateSessionWorkflow } from "../../session/workflow";
import { formatRankedOption } from "../../session/workflowLogic";
import { debugError, logInfo } from "../../shared/log";
import {
  buildRankedMarketPresentations,
  formatDecideChatContent,
} from "../../shared/chatPresentation";
import type { TradingGraphNodeState } from "../../types/graph";
import { emitChatMessage, emitUiEvent } from "../emit";
import { ensureSessionId } from "../persist";
import { getUserAiConfig } from "../model/getUserConfig";
import { createChatModel } from "../model/providers";
import type { WorkflowRunContext } from "../orchestrator/context";

const PROBABILITY_ESTIMATION_SYSTEM_PROMPT = `You are a probability estimation engine for a prediction market trading system.

Your ONLY job is to estimate the probability that a given market question resolves 
YES, based on the news context provided.

You do not decide whether to trade. You do not size positions. You do not recommend 
actions. You do not ask the user anything.

Output ONLY a valid JSON object:
{
  "marketId": string,
  "aiProbability": number,
  "confidence": number,
  "reasoning": string
}

Rules:
- aiProbability must reflect only what the news context supports
- Do not anchor to the market price
- aiProbability and confidence MUST be decimals between 0 and 1 (example: 0.62, not 62)
- confidence LOW (< 0.5) when context is thin, outdated, or contradictory
- confidence HIGH (> 0.7) only when multiple recent sources clearly agree
- reasoning: one sentence, factual, no fluff
- No text outside the JSON object
- No markdown or code blocks`;

function modelContentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  return String(content ?? "");
}

async function fetchNormalizedMarkets(
  marketIds: string[],
  existing: NormalizedMarket[],
): Promise<NormalizedMarket[]> {
  const existingById = new Map(existing.map((market) => [market.id, market]));
  const normalized: NormalizedMarket[] = [];

  for (const marketId of marketIds) {
    const cached = existingById.get(marketId);
    if (cached) {
      normalized.push(cached);
      continue;
    }

    try {
      const market = await getMarketById({ marketId });
      normalized.push(normalizeMarketFromGamma(market));
    } catch (error) {
      debugError("graph.decide", "Failed to fetch market for scoring", { marketId }, error);
    }
  }

  return normalized;
}

async function estimateMarketProbability(
  market: NormalizedMarket,
  researchContext: string,
  loginUserId: string,
): Promise<AIEstimate> {
  const aiConfig = await getUserAiConfig(loginUserId);
  if (!aiConfig) {
    logInfo("graph.decide", "Skipping probability estimate — user AI config unavailable", {
      marketId: market.id,
      loginUserId: loginUserId || null,
    });
    return failedEstimate(market.id, "AI provider is not configured for probability estimates.");
  }

  const model = createChatModel({
    provider: aiConfig.provider,
    apiKey: aiConfig.apiKey,
  });

  const humanPrompt = [
    "Market:",
    `marketId: ${market.id}`,
    `question: ${market.question}`,
    `closesAt: ${market.closesAt || "unknown"}`,
    `currentMarketProbabilityYes: ${market.marketProbability.toFixed(4)}`,
    "",
    "News context:",
    researchContext.trim().length > 0
      ? researchContext.slice(0, 6000)
      : "No research context available for this market.",
  ].join("\n");

  try {
    const response = await model.invoke([
      new SystemMessage(PROBABILITY_ESTIMATION_SYSTEM_PROMPT),
      new HumanMessage(humanPrompt),
    ]);
    const rawText = modelContentToText(response.content);
    const estimate = parseAIEstimateFromModel(rawText, market.id);
    if (estimate.confidence === 0 && estimate.aiProbability === 0) {
      debugError("graph.decide", "Probability estimate parse failed", {
        marketId: market.id,
        rawPreview: rawText.slice(0, 400),
      });
    }
    return estimate;
  } catch (error) {
    debugError(
      "graph.decide",
      "Probability estimation failed",
      { marketId: market.id },
      error,
    );
    return failedEstimate(market.id);
  }
}

function resolveMarketIds(
  shortlistIds: string[],
  researchedIds: string[],
  chosenMarketId?: string,
): string[] {
  const ordered = [...shortlistIds, ...researchedIds];
  if (chosenMarketId) {
    ordered.unshift(chosenMarketId);
  }

  return [...new Set(ordered.filter((marketId) => marketId.trim().length > 0))];
}

async function persistSessionScoring(
  sessionId: string,
  scoring: SessionScoringState,
  normalizedMarkets: NormalizedMarket[],
): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { metadata: true },
  });

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const metadata =
    session.metadata && typeof session.metadata === "object"
      ? (session.metadata as Record<string, unknown>)
      : {};

  await prisma.session.update({
    where: { id: sessionId },
    data: {
      metadata: {
        ...metadata,
        scoring,
        normalizedMarkets,
      } as object,
    },
  });
}

export async function runDecidePhase(ctx: WorkflowRunContext): Promise<void> {
  const sessionId = ctx.sessionId;
  const workflow = await getSessionWorkflow(sessionId);

  if (workflow.phase !== "DECIDE") {
    return;
  }

  logInfo("orchestrator.decide", "run-decide started", {
    sessionId,
    userId: ctx.userId,
    wakeTraceId: ctx.wakeTraceId,
  });

  const loginUserId = ctx.userId ?? "";
  const [researchCookie, shortlist] = await Promise.all([
    getResearchCookie(sessionId),
    Promise.resolve(workflow.shortlist ?? []),
  ]);

  const marketIds = resolveMarketIds(
    workflow.selectedMarketIds ?? shortlist.map((candidate) => candidate.marketId),
    Object.keys(researchCookie),
    workflow.chosen?.marketId ?? workflow.userSpec?.targetMarketId,
  );

  const normalizedMarkets = await fetchNormalizedMarkets(marketIds, []);

  const estimates: Record<string, AIEstimate> = {};
  for (const market of normalizedMarkets) {
    const entries = researchCookie[market.id] ?? [];
    const latest = entries.at(-1);
    const researchContext = latest?.summary ?? entries.map((entry) => entry.summary).join("\n\n");

    estimates[market.id] = await estimateMarketProbability(
      market,
      researchContext,
      loginUserId,
    );
  }

  const scoredMarkets = scoreMarkets(normalizedMarkets, estimates);
  const opportunities = filterOpportunities(scoredMarkets);
  const rankedForDisplay = [...scoredMarkets].sort((left, right) => {
    if (left.ev !== right.ev) {
      return right.ev - left.ev;
    }
    return Math.abs(right.edge) - Math.abs(left.edge);
  });
  const rankedMarketIds = rankedForDisplay.map((market) => market.id);
  const successfulEstimates = Object.values(estimates).filter(
    (estimate) => estimate.confidence > 0,
  ).length;

  const scoring: SessionScoringState = {
    estimates,
    scoredMarkets,
    opportunities,
  };

  await persistSessionScoring(sessionId, scoring, normalizedMarkets);
  await updateSessionWorkflow(sessionId, (current) => ({
    ...current,
    rankedMarketIds,
  }));

  const options = rankedMarketIds.map((marketId) => formatRankedOption(marketId, shortlist));

  const rankedMarkets = buildRankedMarketPresentations(scoredMarkets);

  const pending = createPendingFeedback({
    type: "mcq",
    question:
      "Which market should we focus on next? Options are ranked by expected value — pick one for the detailed background pass.",
    options,
    reason: "The system ranked the researched markets and now needs one final operator choice.",
  });
  await savePendingFeedback(sessionId, pending);

  const emitState = {
    onEvent: ctx.onEvent ?? null,
    sessionId,
    wakeTraceId: ctx.wakeTraceId,
    userId: ctx.userId,
  };

  emitUiEvent(
    emitState,
    "feedback-request",
    {
      requestId: pending.requestId,
      type: pending.type,
      question: pending.question,
      options: pending.options,
      reason: pending.reason,
      phase: "DECIDE",
      rankedMarkets,
    },
    sessionId,
  );
  emitChatMessage(
    emitState,
    "bot",
    formatDecideChatContent(rankedMarkets),
    "Waiting for your final market selection",
    sessionId,
    {
      contentKind: "decide-summary",
      contentData: { rankedMarkets } as unknown as Record<string, unknown>,
    },
  );

  logInfo("orchestrator.decide", "run-decide completed", {
    sessionId,
    userId: ctx.userId,
    marketCount: normalizedMarkets.length,
    successfulEstimates,
    opportunityCount: opportunities.length,
    topMarketId: rankedMarketIds[0] ?? null,
    topEv: rankedForDisplay[0]?.ev ?? null,
  });

  throw new AwaitingFeedbackError(pending.requestId);
}

export async function runDecideNode(state: TradingGraphNodeState) {
  const sessionId = await ensureSessionId(state.sessionId, state.userId);
  return runDecidePhase({
    sessionId,
    userId: state.userId,
    wakeTraceId: state.wakeTraceId ?? "",
    onEvent: state.onEvent,
    userInstruction: state.userInstruction,
    failureCount: state.failureCount,
  });
}
