import { END } from "@langchain/langgraph";
import type { TradingGraphNodeState } from "../types/graph";
import { logGraphTransition } from "../shared/log";

export function routeAfterPromptNode(state: TradingGraphNodeState) {
  logGraphTransition("prompt-loader", "run-model", {
    sessionId: state.sessionId,
    userId: state.userId,
    wakeTraceId: state.wakeTraceId,
  });
  return "run-model";
}

export function routeAfterFeedbackContinuationNode(state: TradingGraphNodeState) {
  if (state.botSleepRequested) {
    logGraphTransition("load-feedback-continuation", String(END), {
      sessionId: state.sessionId,
      userId: state.userId,
      wakeTraceId: state.wakeTraceId,
      botSleepRequested: true,
    });
    return END;
  }

  logGraphTransition("load-feedback-continuation", "run-model", {
    sessionId: state.sessionId,
    userId: state.userId,
    wakeTraceId: state.wakeTraceId,
  });
  return "run-model";
}

export function routeAfterToolCallsNode(state: TradingGraphNodeState) {
  logGraphTransition("run-tool-calls", "run-model", {
    sessionId: state.sessionId,
    userId: state.userId,
    wakeTraceId: state.wakeTraceId,
  });
  return "run-model";
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
