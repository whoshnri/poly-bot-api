import type { AiModelResponse } from "../../types/schemas";
import type { SessionPhase, SessionWorkflowState } from "../../session/workflowLogic";
import type { TradingGraphNodeState } from "../../types/graph";
import type { ToolCall } from "../../types/schemas";
import { buildPhaseFallbackTool, type RecoveryContext } from "./recoveryContext";

const DETERMINISTIC_TOOL_PHASES = new Set<SessionPhase>([
  "DISCOVER",
  "RESEARCH",
  "BACKGROUND",
  "PRICE",
]);

export function shouldRunDeterministicTools(phase: SessionPhase): boolean {
  return DETERMINISTIC_TOOL_PHASES.has(phase);
}

export function buildModelRecoveryContext(
  workflow: SessionWorkflowState,
  state: Pick<TradingGraphNodeState, "userInstruction">,
): RecoveryContext {
  const activeResearchMarketId =
    workflow.phase === "BACKGROUND"
      ? workflow.chosen?.marketId ?? workflow.userSpec?.targetMarketId
      : workflow.userSpec?.targetMarketId ??
        workflow.selectedMarketIds?.find((marketId) =>
          workflow.shortlist?.some((candidate) => candidate.marketId === marketId),
        ) ??
        workflow.chosen?.marketId;

  const activeResearchQuestion =
    workflow.shortlist?.find((candidate) => candidate.marketId === activeResearchMarketId)
      ?.question ??
    workflow.userSpec?.topic ??
    state.userInstruction;

  const chosenMarketId = workflow.chosen?.marketId;

  return {
    searchQuery: activeResearchQuestion,
    phase: workflow.phase,
    shortlistMarketId:
      chosenMarketId ??
      workflow.selectedMarketIds?.[0] ??
      workflow.shortlist?.[0]?.marketId,
    marketId: chosenMarketId,
    tokenId: workflow.chosen?.tokenId?.trim() || undefined,
  };
}

function deterministicPhaseMessage(phase: SessionPhase): string {
  switch (phase) {
    case "DISCOVER":
      return "Loading active Polymarket markets for the shortlist.";
    case "RESEARCH":
      return "Running web research on the next selected market.";
    case "BACKGROUND":
      return "Gathering detailed background research for the chosen market.";
    case "PRICE":
      return "Fetching the current market price before approval.";
    default:
      return "Continuing the workflow.";
  }
}

export function buildDeterministicModelResponse(
  workflow: SessionWorkflowState,
  recoveryContext: RecoveryContext,
): AiModelResponse {
  const fallback = buildPhaseFallbackTool(recoveryContext) as ToolCall;

  return {
    message: deterministicPhaseMessage(workflow.phase),
    reasoning: "Deterministic workflow step — executing the phase tool without waiting on model tool selection.",
    isTradeActive: false,
    toolCalls: [fallback],
    nextStage: {
      summary: `Phase ${workflow.phase} in progress`,
      todo: `Complete ${fallback.tool} for the current workflow step`,
      stageAction: null,
      stageActionData: null,
    },
  };
}

export function ensureActionableModelResponse(
  response: AiModelResponse,
  recoveryContext?: RecoveryContext,
): AiModelResponse {
  if (response.toolCalls.length > 0 || response.nextStage.stageAction !== null) {
    return response;
  }

  const fallback = buildPhaseFallbackTool(recoveryContext) as ToolCall;
  return {
    ...response,
    toolCalls: [fallback],
    reasoning:
      response.reasoning.trim().length > 0
        ? response.reasoning
        : "Model returned narration only; continuing with the phase tool.",
  };
}
