import type { GetMarketsResponse } from "../types/polymarket";
import {
  mergeShortlist,
  shortlistResearchComplete,
  type MarketCandidate,
  type SessionPhase,
  type SessionWorkflowState,
} from "./workflowLogic";
import type { ResearchCookie } from "./researchCookieLogic";
import { listResearchedMarketIds } from "./researchCookieLogic";

export function extractCandidatesFromMarkets(data: unknown): MarketCandidate[] {
  if (!data || typeof data !== "object") {
    return [];
  }

  const markets = (data as GetMarketsResponse).markets;
  if (!Array.isArray(markets)) {
    return [];
  }

  const candidates: MarketCandidate[] = [];
  for (const market of markets) {
    if (!market || typeof market !== "object") {
      continue;
    }

    const marketId = typeof market.id === "string" ? market.id : null;
    const question = typeof market.question === "string" ? market.question : null;
    if (!marketId || !question) {
      continue;
    }

    if (
      market.active === false ||
      market.closed === true ||
      market.archived === true ||
      market.acceptingOrders === false
    ) {
      continue;
    }

    const tokenIds = Array.isArray(market.outcomes)
      ? market.outcomes
          .map((outcome) =>
            outcome && typeof outcome === "object" && typeof outcome.tokenId === "string"
              ? outcome.tokenId
              : null,
          )
          .filter((tokenId): tokenId is string => tokenId !== null)
      : undefined;

    candidates.push({
      marketId,
      question,
      tokenIds,
      category: typeof market.category === "string" ? market.category : undefined,
      endDate: typeof market.endDate === "string" ? market.endDate : undefined,
      liquidity: typeof market.liquidity === "number" ? market.liquidity : undefined,
      volume: typeof market.volume24hr === "number" ? market.volume24hr : market.volume,
    });
  }

  return mergeShortlist([], candidates);
}

export function resolveResearchMarketId(
  workflow: SessionWorkflowState,
  cookie: ResearchCookie,
  explicitMarketId?: string,
): string | null {
  if (explicitMarketId) {
    return explicitMarketId;
  }

  const researched = new Set(listResearchedMarketIds(cookie));

  if (workflow.phase === "BACKGROUND") {
    const backgroundMarketId = workflow.chosen?.marketId ?? workflow.userSpec?.targetMarketId;
    return backgroundMarketId ?? null;
  }

  const selectedMarketIds = workflow.selectedMarketIds ?? [];
  const nextSelected = selectedMarketIds.find((marketId) => !researched.has(marketId));
  if (nextSelected) {
    return nextSelected;
  }

  const shortlist = workflow.shortlist ?? [];
  const nextShortlist = shortlist.find((candidate) => !researched.has(candidate.marketId));
  return nextShortlist?.marketId ?? null;
}

export function transitionAfterGetMarkets(
  workflow: SessionWorkflowState,
  data: unknown,
): SessionWorkflowState {
  const candidates = extractCandidatesFromMarkets(data);

  if (workflow.phase !== "DISCOVER" || candidates.length === 0) {
    return workflow;
  }

  return {
    ...workflow,
    shortlist: mergeShortlist(workflow.shortlist, candidates),
    selectedMarketIds: undefined,
    rankedMarketIds: undefined,
    chosen: undefined,
    phase: "SHORTLIST",
  };
}

export function transitionAfterWebResearch(
  workflow: SessionWorkflowState,
  cookie: ResearchCookie,
): SessionWorkflowState {
  const researchedMarketIds = listResearchedMarketIds(cookie);

  if (workflow.phase === "RESEARCH") {
    if (!shortlistResearchComplete(workflow.selectedMarketIds, researchedMarketIds)) {
      const nextResearchMarketId = workflow.selectedMarketIds?.find(
        (marketId) => !researchedMarketIds.includes(marketId),
      );
      return {
        ...workflow,
        userSpec: nextResearchMarketId
          ? {
              source: workflow.userSpec?.source ?? "feedback",
              topic:
                workflow.shortlist?.find((candidate) => candidate.marketId === nextResearchMarketId)
                  ?.question ?? workflow.userSpec?.topic,
              targetMarketId: nextResearchMarketId,
            }
          : workflow.userSpec,
      };
    }

    return {
      ...workflow,
      phase: "DECIDE",
    };
  }

  if (workflow.phase === "BACKGROUND") {
    const chosenMarketId = workflow.chosen?.marketId ?? workflow.userSpec?.targetMarketId;
    if (!chosenMarketId || !researchedMarketIds.includes(chosenMarketId)) {
      return workflow;
    }

    return {
      ...workflow,
      phase: "PRICE",
    };
  }

  return workflow;
}

export function transitionAfterGetMarketPrice(
  workflow: SessionWorkflowState,
  tokenId: string,
): SessionWorkflowState {
  if (workflow.phase !== "PRICE") {
    return workflow;
  }

  return {
    ...workflow,
    chosen: workflow.chosen
      ? { ...workflow.chosen, tokenId }
      : {
          marketId: "unknown",
          tokenId,
          side: "BUY",
          thesis: "Price fetched for trade evaluation.",
        },
    phase: "APPROVE",
  };
}

export function phaseDirective(phase: SessionPhase): string {
  switch (phase) {
    case "SPEC":
      return "Ask the operator for a direction before starting market discovery.";
    case "DISCOVER":
      return "Get active Polymarket markets with get-markets. Do not use global public search for discovery.";
    case "SHORTLIST":
      return "Present exactly 10 active markets in a multi-select feedback card and require at least one selection.";
    case "RESEARCH":
      return "Run Tavily web research on every market the operator selected, one by one, until all selected markets have research saved.";
    case "DECIDE":
      return "Use deterministic calculations to rank the researched markets, sort them in ascending order, and ask the operator to choose a final focus market.";
    case "BACKGROUND":
      return "Run detailed Tavily background research for the final chosen market, then fetch any full market details needed for the approval breakdown.";
    case "PRICE":
      return "Fetch get-market-price for the chosen token before presenting the approval summary.";
    case "APPROVE":
      return "Present the final chosen market, the deterministic calculation interpretation, and the detailed research context, then ask the operator whether to approve the trade.";
    case "EXECUTE":
      return "Operator approved. Set nextStage.stageAction=START_TRADE with the validated order.";
    case "SLEEP":
      return "Session is paused after operator rejection. Use WAIT only if a scheduled wake is appropriate.";
    default:
      return "Follow the phased workflow.";
  }
}
