import { buildGuardrailsDescription } from "../config/bot";
import { formatOpportunitiesForPrompt, readSessionScoring } from "../lib/scoring";
import { buildSessionStageHistory } from "../shared/helpers";
import { OPERATOR_VOICE_GUIDELINES } from "../shared/operatorVoice";
import { buildModelToolsDefinition } from "../tools/registry";
import prisma from "../db/prisma";
import {
  allowedToolsForPhase,
  formatRankedOption,
  formatShortlistOption,
  readPreSessionFromMetadata,
  type PreSessionInput,
  type SessionWorkflowState,
  type WorkflowToolSlug,
} from "./workflowLogic";
import { getResearchCookie, summarizeResearchCookie } from "./researchCookie";
import { getSessionWorkflow } from "./workflow";
import { phaseDirective } from "./workflowTransitions";

export type WorkflowPromptContext = {
  workflow: SessionWorkflowState;
  researchSummary: string;
  allowedTools: WorkflowToolSlug[];
  preSession?: PreSessionInput | null;
};

export async function loadWorkflowPromptContext(
  sessionId: string,
): Promise<WorkflowPromptContext> {
  const [workflow, cookie, session] = await Promise.all([
    getSessionWorkflow(sessionId),
    getResearchCookie(sessionId),
    prisma.session.findUnique({
      where: { id: sessionId },
      select: { metadata: true },
    }),
  ]);

  return {
    workflow,
    researchSummary: summarizeResearchCookie(cookie),
    allowedTools: allowedToolsForPhase(workflow.phase),
    preSession: readPreSessionFromMetadata(session?.metadata),
  };
}

function formatShortlist(workflow: SessionWorkflowState): string {
  if (!workflow.shortlist || workflow.shortlist.length === 0) {
    return "No shortlisted markets yet.";
  }

  return workflow.shortlist
    .map(
      (candidate, index) =>
        `${index + 1}. ${formatShortlistOption(candidate)}`,
    )
    .join("\n");
}

function formatChosen(workflow: SessionWorkflowState): string {
  if (!workflow.chosen) {
    return "No chosen market yet.";
  }

  return [
    `marketId=${workflow.chosen.marketId}`,
    `tokenId=${workflow.chosen.tokenId}`,
    `side=${workflow.chosen.side}`,
    `thesis=${workflow.chosen.thesis}`,
  ].join(" · ");
}

export function buildWorkflowToolsDefinition(tools: ReturnType<typeof allowedToolsForPhase>): string {
  return buildModelToolsDefinition(tools);
}

function formatPreSessionBlock(preSession: PreSessionInput | null | undefined): string | null {
  if (!preSession) {
    return null;
  }

  const selected =
    preSession.markets.find((market) => market.marketId === preSession.selectedMarketId) ??
    preSession.markets[0];

  return [
    "Pre-session explore context:",
    `- topic: ${preSession.topic}`,
    preSession.summary ? `- explore summary: ${preSession.summary}` : null,
    preSession.queries?.length
      ? `- search queries: ${preSession.queries.join(" | ")}`
      : null,
    selected ? `- selected market: ${selected.question} [${selected.marketId}]` : null,
    preSession.exploreMessages?.length
      ? [
          "- recent explore chat:",
          ...preSession.exploreMessages.slice(-4).map(
            (message) =>
              `  ${message.role === "user" ? "Operator" : "Assistant"}: ${message.content}`,
          ),
        ].join("\n")
      : null,
    "Discovery and shortlist are already complete — begin at RESEARCH.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function formatApproveScoringBlock(opportunities: ReturnType<typeof readSessionScoring>): string {
  if (!opportunities) {
    return [
      "Deterministic scoring results are not available yet.",
      "Wait for the DECIDE scoring pass before presenting trade approval.",
    ].join("\n");
  }

  return formatOpportunitiesForPrompt(opportunities.opportunities);
}

export function buildWorkflowContextBlock(
  context: WorkflowPromptContext,
  scoring?: ReturnType<typeof readSessionScoring>,
): string {
  const { workflow, researchSummary, allowedTools, preSession } = context;

  return [
    "Session workflow state:",
    `- phase: ${workflow.phase}`,
    `- directive: ${phaseDirective(workflow.phase)}`,
    workflow.userSpec?.topic ? `- operator topic: ${workflow.userSpec.topic}` : null,
    workflow.operatorDecision ? `- operator decision: ${workflow.operatorDecision}` : null,
    "",
    formatPreSessionBlock(preSession),
    preSession ? "" : null,
    "Shortlist (max 10):",
    formatShortlist(workflow),
    "",
    workflow.selectedMarketIds?.length
      ? `Selected markets: ${workflow.selectedMarketIds
          .map((marketId) => formatRankedOption(marketId, workflow.shortlist))
          .join(" | ")}`
      : "Selected markets: none yet.",
    workflow.rankedMarketIds?.length
      ? `Ranked markets: ${workflow.rankedMarketIds
          .map((marketId) => formatRankedOption(marketId, workflow.shortlist))
          .join(" | ")}`
      : "Ranked markets: none yet.",
    "",
    "Chosen market:",
    formatChosen(workflow),
    "",
    "Research cookie summary:",
    researchSummary,
    workflow.phase === "APPROVE"
      ? [
          "",
          formatApproveScoringBlock(scoring ?? null),
        ].join("\n")
      : null,
    "",
    buildWorkflowToolsDefinition(allowedTools),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

async function loadSessionScoring(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { metadata: true },
  });

  return readSessionScoring(session?.metadata ?? null);
}

export async function buildPhaseAwareInitializationPrompt(
  sessionId: string,
  userInstruction: string,
): Promise<string> {
  const [context, scoring] = await Promise.all([
    loadWorkflowPromptContext(sessionId),
    loadSessionScoring(sessionId),
  ]);

  const preSessionRules = context.preSession
    ? [
        "Phased pipeline (explore already completed):",
        "RESEARCH (Tavily on selected markets) → DECIDE → BACKGROUND → PRICE → APPROVE → EXECUTE.",
        "",
        "Rules:",
        "- Market discovery and shortlist selection already happened in explore chat — do not run DISCOVER or SHORTLIST again.",
        "- Begin Tavily research on the pre-selected market(s) immediately.",
        "- Run Tavily research on every selected market before deciding.",
        "- DECIDE scoring is deterministic and handled outside the model, then the operator picks one final market.",
        "- Run detailed Tavily background research on the final pick before approval.",
        "- In APPROVE, present the final calculation interpretation and ask for approval with request_feedback.",
        "- Keep nextStage.stageAction null until the current phase objective is complete.",
      ]
    : [
        "Phased pipeline:",
        "DISCOVER (get-markets) → SHORTLIST (multi-select feedback) → RESEARCH (Tavily on every selected market) → DECIDE (deterministic scoring + final market selection) → BACKGROUND (detailed Tavily) → PRICE → APPROVE → EXECUTE.",
        "",
        "Rules:",
        "- Never START_TRADE before phase EXECUTE (operator approval required).",
        "- Discovery must use active markets from get-markets, not global public search.",
        "- After discovery, present exactly 10 markets in a multi-select request_feedback card and wait for at least one operator selection.",
        "- Run Tavily research on every selected market before deciding.",
        "- DECIDE scoring is deterministic and handled outside the model, then the operator picks one final market.",
        "- Run detailed Tavily background research on the final pick before approval.",
        "- In APPROVE, present the final calculation interpretation and ask for approval with request_feedback.",
        "- Keep nextStage.stageAction null until the current phase objective is complete.",
      ];

  return [
    "You are an autonomous Polymarket trading assistant.",
    "Follow the phased workflow below. Only use tools allowed in the current phase.",
    OPERATOR_VOICE_GUIDELINES,
    "",
    "Operator instruction:",
    userInstruction.trim(),
    "",
    buildWorkflowContextBlock(context, scoring),
    "",
    ...preSessionRules,
    "",
    buildGuardrailsDescription(),
  ].join("\n");
}

export async function buildPhaseAwareWakePrompt(sessionId: string): Promise<string> {
  const [stageHistory, context, scoring] = await Promise.all([
    buildSessionStageHistory(sessionId),
    loadWorkflowPromptContext(sessionId),
    loadSessionScoring(sessionId),
  ]);

  return [
    "You are an autonomous Polymarket trading assistant resuming an active session.",
    OPERATOR_VOICE_GUIDELINES,
    "",
    "Stage history:",
    stageHistory,
    "",
    buildWorkflowContextBlock(context, scoring),
    "",
    "Resume from the current phase directive above.",
    "Use the latest stage todo as context, but phase rules take precedence.",
    "",
    buildGuardrailsDescription(),
  ].join("\n");
}
