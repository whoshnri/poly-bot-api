import { END } from "@langchain/langgraph";
import { getSessionWorkflow } from "../session/workflow";
import type { TradingGraphNodeState } from "../types/graph";
import { logGraphTransition } from "../shared/log";
import { shouldRunDeterministicTools } from "./model/phaseExecution";

async function resolvePostPromptRoute(state: TradingGraphNodeState): Promise<string> {
  if (!state.sessionId) {
    return "run-model";
  }

  const workflow = await getSessionWorkflow(state.sessionId);
  if (workflow.phase === "DECIDE") {
    return "run-decide";
  }
  if (shouldRunDeterministicTools(workflow.phase)) {
    return "run-deterministic-phase";
  }
  return "run-model";
}

export async function routeAfterPromptNode(state: TradingGraphNodeState) {
  const next = await resolvePostPromptRoute(state);
  logGraphTransition("prompt-loader", next, {
    sessionId: state.sessionId,
    userId: state.userId,
    wakeTraceId: state.wakeTraceId,
  });
  return next;
}

export async function routeAfterFeedbackContinuationNode(state: TradingGraphNodeState) {
  if (state.botSleepRequested) {
    logGraphTransition("load-feedback-continuation", String(END), {
      sessionId: state.sessionId,
      userId: state.userId,
      wakeTraceId: state.wakeTraceId,
      botSleepRequested: true,
    });
    return END;
  }

  if (!state.sessionId) {
    return "run-model";
  }

  const workflow = await getSessionWorkflow(state.sessionId);
  let next: string;
  if (workflow.phase === "DECIDE") {
    next = "run-decide";
  } else if (shouldRunDeterministicTools(workflow.phase)) {
    next = "run-deterministic-phase";
  } else {
    next = "run-model";
  }

  logGraphTransition("load-feedback-continuation", next, {
    sessionId: state.sessionId,
    userId: state.userId,
    wakeTraceId: state.wakeTraceId,
    phase: workflow.phase,
  });
  return next;
}

export async function routeAfterToolCallsNode(state: TradingGraphNodeState) {
  const next = await resolvePostPromptRoute(state);
  logGraphTransition("run-tool-calls", String(next), {
    sessionId: state.sessionId,
    userId: state.userId,
    wakeTraceId: state.wakeTraceId,
  });
  return next;
}

export function routeInitialPromptNode(state: TradingGraphNodeState) {
  let next: string;
  if (state.feedbackContinuation) {
    next = "load-feedback-continuation";
  } else if (state.sessionId && state.userInstruction.trim().length === 0 && !state.forceInitPath) {
    next = "load-wake-prompt";
  } else {
    next = "load-init-prompt";
  }

  logGraphTransition("START", next, {
    sessionId: state.sessionId,
    userId: state.userId,
    wakeTraceId: state.wakeTraceId,
  });
  return next;
}

export function routeAfterModelNode(state: TradingGraphNodeState) {
  if (!state.aiResponse) {
    throw new Error("Model routing requires an AI response.");
  }

  let next: string;
  if (state.aiResponse.toolCalls.length > 0) {
    next = "run-tool-calls";
  } else if (state.aiResponse.nextStage.stageAction !== null) {
    next = "run-stage-action";
  } else {
    next = END;
  }

  logGraphTransition("run-model", next, {
    sessionId: state.sessionId,
    userId: state.userId,
    wakeTraceId: state.wakeTraceId,
    toolCallCount: state.aiResponse.toolCalls.length,
    stageAction: state.aiResponse.nextStage.stageAction,
    haltedWithoutAction: next === END,
  });
  return next;
}

export function routeAfterStageActionNode(state: TradingGraphNodeState) {
  const next = state.stageActionComplete ? END : "run-model";
  logGraphTransition("run-stage-action", String(next), {
    sessionId: state.sessionId,
    userId: state.userId,
    wakeTraceId: state.wakeTraceId,
    stageActionComplete: state.stageActionComplete,
    stopReason: state.stopReason,
  });
  return next;
}
