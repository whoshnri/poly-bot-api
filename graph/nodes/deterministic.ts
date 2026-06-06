import { logInfo } from "../../shared/log";
import type { TradingGraphNodeState } from "../../types/graph";
import { getSessionWorkflow } from "../../session/workflow";
import { emitUiEvent } from "../emit";
import { createAiMessage } from "../messages";
import { ensureSessionId, persistAiStage } from "../persist";
import {
  buildDeterministicModelResponse,
  buildModelRecoveryContext,
} from "../model/phaseExecution";

export async function runDeterministicPhaseNode(state: TradingGraphNodeState) {
  const sessionId = await ensureSessionId(state.sessionId, state.userId);
  const workflow = await getSessionWorkflow(sessionId);
  const recoveryContext = buildModelRecoveryContext(workflow, state);
  const aiResponse = buildDeterministicModelResponse(workflow, recoveryContext);

  logInfo("graph.node", "run-deterministic-phase started", {
    sessionId,
    userId: state.userId,
    wakeTraceId: state.wakeTraceId,
    phase: workflow.phase,
    tool: aiResponse.toolCalls[0]?.tool ?? null,
  });

  await persistAiStage(sessionId, aiResponse);

  emitUiEvent(
    state,
    "ai-response",
    {
      node: "run-deterministic-phase",
      response: aiResponse as unknown as Record<string, unknown>,
      toolCallCount: aiResponse.toolCalls.length,
      stageAction: aiResponse.nextStage.stageAction,
      deterministic: true,
    },
    sessionId,
  );

  return {
    sessionId,
    aiResponse,
    messages: [createAiMessage(JSON.stringify(aiResponse))],
  };
}
