import { randomUUID } from "node:crypto";
import { GraphRecursionError } from "@langchain/langgraph";
import { debugError, logInfo, logWarn } from "../../shared/log";
import { AwaitingFeedbackError } from "../../session/feedback";
import { CircuitBreakerError } from "../../shared/circuitBreaker";
import { DEFAULT_GRAPH_RECURSION_LIMIT, GraphTurnLimitError } from "../../shared/limits";
import {
  readErrorMessage,
  shouldEmitRunErrorToUi,
} from "../../shared/errorPresentation";
import { getSessionWorkflow } from "../../session/workflow";
import type { SessionPhase } from "../../session/workflowLogic";
import type { CompileTradingGraphParams } from "../../types/graph";
import { compileAiGraph } from "../compileAiGraph";
import { ensureSessionId } from "../persist";
import { runDecidePhase } from "../nodes/decide";
import { createWorkflowContext } from "./context";
import {
  runBackgroundPhase,
  runDiscoverPhase,
  runPricePhase,
  runResearchLoop,
  requestShortlistFeedback,
} from "./deterministicPhases";
import { applyFeedbackContinuation } from "./feedbackContinuation";

const AI_GRAPH_PHASES = new Set<SessionPhase>(["APPROVE", "EXECUTE", "SPEC"]);

function needsAiGraph(phase: SessionPhase): boolean {
  return AI_GRAPH_PHASES.has(phase);
}

let aiGraphSingleton: ReturnType<typeof compileAiGraph> | null = null;

function getAiGraph() {
  if (!aiGraphSingleton) {
    aiGraphSingleton = compileAiGraph();
  }
  return aiGraphSingleton;
}

async function runDeterministicPhases(ctx: ReturnType<typeof createWorkflowContext>): Promise<void> {
  while (true) {
    const workflow = await getSessionWorkflow(ctx.sessionId);

    if (needsAiGraph(workflow.phase)) {
      return;
    }

    switch (workflow.phase) {
      case "DISCOVER":
        await runDiscoverPhase(ctx);
        await requestShortlistFeedback(ctx);
        return;

      case "SHORTLIST":
        await requestShortlistFeedback(ctx);
        return;

      case "RESEARCH":
        await runResearchLoop(ctx);
        continue;

      case "DECIDE":
        await runDecidePhase(ctx);
        return;

      case "BACKGROUND":
        await runBackgroundPhase(ctx);
        continue;

      case "PRICE":
        await runPricePhase(ctx);
        continue;

      case "SLEEP":
        return;

      default:
        logWarn("orchestrator.run", "Unknown phase in deterministic loop", {
          sessionId: ctx.sessionId,
          phase: workflow.phase,
        });
        return;
    }
  }
}

async function invokeAiGraph(
  params: CompileTradingGraphParams,
  wakeTraceId: string,
  sessionId: string,
  userInstruction: string,
) {
  const aiGraph = getAiGraph();
  return aiGraph.invoke({
    ...params,
    sessionId,
    wakeTraceId,
    userInstruction,
    feedbackContinuation: null,
  });
}

export async function runSession(params: CompileTradingGraphParams = {}) {
  const wakeTraceId = randomUUID();
  const initialSessionId = params.sessionId ?? null;

  logInfo("orchestrator.run", "Session run started", {
    sessionId: initialSessionId,
    userId: params.userId ?? null,
    wakeTraceId,
    forceInitPath: params.forceInitPath ?? false,
    hasInstruction: Boolean(params.userInstruction?.trim()),
    hasFeedbackContinuation: Boolean(params.feedbackContinuation),
  });

  if (params.onEvent && initialSessionId) {
    params.onEvent({
      id: randomUUID(),
      sessionId: initialSessionId,
      timestamp: new Date().toISOString(),
      kind: "graph-run-start",
      payload: {
        wakeTraceId,
        forceInitPath: params.forceInitPath ?? false,
      },
    });
  }

  try {
    const sessionId = await ensureSessionId(initialSessionId, params.userId ?? null);
    const ctx = createWorkflowContext(params, wakeTraceId, sessionId);

    if (params.feedbackContinuation) {
      const continuationResult = await applyFeedbackContinuation(
        ctx,
        params.feedbackContinuation,
      );
      if (continuationResult.botSleepRequested) {
        const result = {
          sessionId,
          stopReason: continuationResult.stopReason ?? null,
          stageActionComplete: continuationResult.stageActionComplete ?? true,
        };
        emitRunComplete(params, sessionId, wakeTraceId, result);
        return result;
      }
    }

    await runDeterministicPhases(ctx);

    const workflow = await getSessionWorkflow(sessionId);
    if (workflow.phase === "SLEEP") {
      const result = {
        sessionId,
        stopReason: "Session is sleeping.",
        stageActionComplete: true,
      };
      emitRunComplete(params, sessionId, wakeTraceId, result);
      return result;
    }

    if (needsAiGraph(workflow.phase)) {
      const result = await invokeAiGraph(params, wakeTraceId, sessionId, ctx.userInstruction);
      const finalResult = normalizeRunResult(result, sessionId);
      emitRunComplete(params, sessionId, wakeTraceId, finalResult);
      return finalResult;
    }

    const finalResult = {
      sessionId,
      stopReason: null as string | null,
      stageActionComplete: false,
    };
    emitRunComplete(params, sessionId, wakeTraceId, finalResult);
    return finalResult;
  } catch (error) {
    return handleRunError(error, params, initialSessionId, wakeTraceId);
  }
}

function normalizeRunResult(
  result: Record<string, unknown>,
  sessionId: string,
) {
  return {
    sessionId:
      typeof result.sessionId === "string" ? result.sessionId : sessionId,
    stopReason:
      typeof result.stopReason === "string" || result.stopReason === null
        ? result.stopReason
        : null,
    stageActionComplete: Boolean(result.stageActionComplete),
    failureCount: typeof result.failureCount === "number" ? result.failureCount : 0,
  };
}

function emitRunComplete(
  params: CompileTradingGraphParams,
  sessionId: string,
  wakeTraceId: string,
  result: {
    stopReason: string | null;
    stageActionComplete: boolean;
    failureCount?: number;
  },
) {
  logInfo("orchestrator.run", "Session run completed", {
    sessionId,
    userId: params.userId ?? null,
    wakeTraceId,
    stopReason: result.stopReason,
    stageActionComplete: result.stageActionComplete,
    failureCount: result.failureCount ?? 0,
  });

  if (params.onEvent && sessionId) {
    params.onEvent({
      id: randomUUID(),
      sessionId,
      timestamp: new Date().toISOString(),
      kind: "graph-run-complete",
      payload: {
        wakeTraceId,
        stopReason: result.stopReason,
        stageActionComplete: result.stageActionComplete,
      },
    });
  }
}

function handleRunError(
  error: unknown,
  params: CompileTradingGraphParams,
  initialSessionId: string | null,
  wakeTraceId: string,
) {
  if (error instanceof AwaitingFeedbackError) {
    logInfo("orchestrator.run", "Session paused awaiting operator feedback", {
      sessionId: initialSessionId,
      userId: params.userId ?? null,
      wakeTraceId,
      requestId: error.requestId,
    });
    if (params.onEvent && initialSessionId) {
      params.onEvent({
        id: randomUUID(),
        sessionId: initialSessionId,
        timestamp: new Date().toISOString(),
        kind: "graph-run-complete",
        payload: {
          wakeTraceId,
          stopReason: "Awaiting operator feedback.",
          awaitingFeedback: true,
          requestId: error.requestId,
          stageActionComplete: false,
        },
      });
    }
    return {
      sessionId: initialSessionId,
      stopReason: "Awaiting operator feedback.",
      stageActionComplete: false,
    };
  }

  if (error instanceof CircuitBreakerError) {
    const stopReason = error.message;
    logWarn("orchestrator.run", "Session stopped by circuit breaker", {
      sessionId: initialSessionId,
      userId: params.userId ?? null,
      wakeTraceId,
      failureCount: error.failureCount,
    });
    if (params.onEvent && initialSessionId) {
      params.onEvent({
        id: randomUUID(),
        sessionId: initialSessionId,
        timestamp: new Date().toISOString(),
        kind: "graph-run-complete",
        payload: {
          wakeTraceId,
          stopReason: shouldEmitRunErrorToUi(error) ? stopReason : null,
          circuitBreakerTripped: true,
          failureCount: error.failureCount,
          stageActionComplete: false,
        },
      });
    }
    return {
      sessionId: initialSessionId,
      stopReason,
      stageActionComplete: false,
    };
  }

  if (error instanceof GraphTurnLimitError) {
    const stopReason = error.message;
    logWarn("orchestrator.run", "Session stopped by turn limit", {
      sessionId: initialSessionId,
      userId: params.userId ?? null,
      wakeTraceId,
      turnCount: error.turnCount,
    });
    if (params.onEvent && initialSessionId) {
      params.onEvent({
        id: randomUUID(),
        sessionId: initialSessionId,
        timestamp: new Date().toISOString(),
        kind: "graph-run-complete",
        payload: {
          wakeTraceId,
          stopReason: shouldEmitRunErrorToUi(error) ? stopReason : null,
          turnLimitReached: true,
          turnCount: error.turnCount,
          stageActionComplete: false,
        },
      });
    }
    return {
      sessionId: initialSessionId,
      stopReason,
      stageActionComplete: false,
    };
  }

  if (error instanceof GraphRecursionError) {
    const stopReason = `Graph step limit reached (${DEFAULT_GRAPH_RECURSION_LIMIT}). Use Continue session to pick up where you left off.`;
    logWarn("orchestrator.run", "AI graph stopped by recursion limit", {
      sessionId: initialSessionId,
      userId: params.userId ?? null,
      wakeTraceId,
      recursionLimit: DEFAULT_GRAPH_RECURSION_LIMIT,
    });
    if (params.onEvent && initialSessionId) {
      params.onEvent({
        id: randomUUID(),
        sessionId: initialSessionId,
        timestamp: new Date().toISOString(),
        kind: "graph-run-complete",
        payload: {
          wakeTraceId,
          stopReason: null,
          recursionLimitReached: true,
          recursionLimit: DEFAULT_GRAPH_RECURSION_LIMIT,
          stageActionComplete: false,
        },
      });
    }
    return {
      sessionId: initialSessionId,
      stopReason,
      stageActionComplete: false,
    };
  }

  const errorMessage = readErrorMessage(error);
  const errorName = error instanceof Error ? error.name : "UnknownError";

  debugError(
    "orchestrator.run",
    "Session run failed",
    {
      sessionId: initialSessionId,
      userId: params.userId ?? null,
      wakeTraceId,
    },
    error,
  );

  if (params.onEvent && initialSessionId) {
    params.onEvent({
      id: randomUUID(),
      sessionId: initialSessionId,
      timestamp: new Date().toISOString(),
      kind: "graph-run-complete",
      payload: {
        wakeTraceId,
        stopReason: shouldEmitRunErrorToUi(error) ? errorMessage : null,
        stageActionComplete: false,
        failed: shouldEmitRunErrorToUi(error),
        ...(shouldEmitRunErrorToUi(error)
          ? { errorName }
          : { suppressed: true }),
      },
    });
  }

  return {
    sessionId: initialSessionId,
    stopReason: errorMessage,
    stageActionComplete: false,
  };
}
