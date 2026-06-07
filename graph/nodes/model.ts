import { CircuitBreakerError, incrementFailureCount, shouldTripCircuitBreaker } from "../../shared/circuitBreaker";
import { GraphTurnLimitError, shouldStopGraphTurns } from "../../shared/limits";
import { logInfo } from "../../shared/log";
import type { TradingGraphNodeState } from "../../types/graph";
import { emitChatMessage, emitUiEvent } from "../emit";
import { invokeUniversalModel } from "../model/invoke";
import {
  buildModelRecoveryContext,
  ensureActionableModelResponse,
} from "../model/phaseExecution";
import { ensureSessionId, persistAiStage } from "../persist";
import { createAiMessage } from "../messages";
import prisma from "../../db/prisma";
import {
  readSessionScoring,
  serializeOpportunitiesForEvent,
} from "../../lib/scoring";
import { getSessionWorkflow } from "../../session/workflow";
import { allowedToolsForPhase, readPreSessionFromMetadata } from "../../session/workflowLogic";

export async function runModelNode(state: TradingGraphNodeState) {
  if (shouldTripCircuitBreaker(state.failureCount)) {
    throw new CircuitBreakerError(state.failureCount);
  }
  if (shouldStopGraphTurns(state.turnCount)) {
    throw new GraphTurnLimitError(state.turnCount);
  }

  logInfo("graph.node", "run-model started", {
    sessionId: state.sessionId,
    userId: state.userId,
    wakeTraceId: state.wakeTraceId,
    messageCount: state.messages.length,
    failureCount: state.failureCount,
  });
  const sessionId = await ensureSessionId(state.sessionId, state.userId);
  const workflow = await getSessionWorkflow(sessionId);
  if (workflow.phase === "DECIDE") {
    throw new Error("DECIDE phase is handled by run-decide; run-model must not execute.");
  }

  const recoveryContext = buildModelRecoveryContext(workflow, state);
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { metadata: true },
  });
  const hasPreSession = Boolean(readPreSessionFromMetadata(session?.metadata));

  let aiResponse = await invokeUniversalModel(
    state.messages,
    {
      allowedTools: allowedToolsForPhase(workflow.phase),
      phase: workflow.phase,
      hasPreSession,
    },
    recoveryContext,
    state.userId ?? "",
  );

  aiResponse = ensureActionableModelResponse(aiResponse, recoveryContext);
  await persistAiStage(sessionId, aiResponse);

  emitChatMessage(state, "bot", aiResponse.message, aiResponse.reasoning, sessionId);

  let opportunities: Record<string, unknown>[] | undefined;
  if (workflow.phase === "APPROVE") {
    if (state.opportunities.length > 0) {
      opportunities = serializeOpportunitiesForEvent(state.opportunities);
    } else {
      const scoring = readSessionScoring(session?.metadata ?? null);
      opportunities = scoring
        ? serializeOpportunitiesForEvent(scoring.opportunities)
        : [];
    }
  }

  emitUiEvent(
    state,
    "ai-response",
    {
      node: "run-model",
      response: aiResponse as unknown as Record<string, unknown>,
      toolCallCount: aiResponse.toolCalls.length,
      stageAction: aiResponse.nextStage.stageAction,
      ...(workflow.phase === "APPROVE" ? { opportunities: opportunities ?? [] } : {}),
    },
    sessionId,
  );

  return {
    sessionId,
    aiResponse,
    turnCount: 1,
    messages: [createAiMessage(JSON.stringify(aiResponse))],
  };
}
