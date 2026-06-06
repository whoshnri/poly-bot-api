import type { BotUiEventSink, CompileTradingGraphParams } from "../../types/graph";

export type WorkflowRunContext = {
  sessionId: string;
  userId: string | null;
  wakeTraceId: string;
  onEvent: BotUiEventSink | null | undefined;
  userInstruction: string;
  failureCount: number;
};

export function createWorkflowContext(
  params: CompileTradingGraphParams,
  wakeTraceId: string,
  sessionId: string,
): WorkflowRunContext {
  return {
    sessionId,
    userId: params.userId ?? null,
    wakeTraceId,
    onEvent: params.onEvent,
    userInstruction: params.userInstruction ?? "",
    failureCount: 0,
  };
}

export function toGraphNodeState(ctx: WorkflowRunContext) {
  return {
    sessionId: ctx.sessionId,
    userId: ctx.userId,
    wakeTraceId: ctx.wakeTraceId,
    onEvent: ctx.onEvent ?? null,
    userInstruction: ctx.userInstruction,
    failureCount: ctx.failureCount,
    forceInitPath: false,
    feedbackContinuation: null,
    turnCount: 0,
    prompt: "",
    messages: [],
    aiResponse: null,
    intendedStartTradeOrder: null,
    toolResults: [],
    normalizedMarkets: [],
    stageActionComplete: false,
    stopReason: null,
    botSleepRequested: false,
  };
}
