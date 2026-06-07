import { randomUUID } from "node:crypto";
import {
  CircuitBreakerError,
  incrementFailureCount,
  shouldTripCircuitBreaker,
} from "../../shared/circuitBreaker";
import { debugError, debugLog, logEvent, logInfo } from "../../shared/log";
import {
  AwaitingFeedbackError,
  createPendingFeedback,
  savePendingFeedback,
} from "../../session/feedback";
import { appendResearchEntry, getResearchCookie } from "../../session/researchCookie";
import {
  researchRetryRequiredMessage,
  recordResearchFailure,
  recordResearchSuccess,
} from "../../session/researchGate";
import {
  allowedToolsForPhase,
  getSessionWorkflow,
  isToolAllowedInPhase,
  updateSessionWorkflow,
} from "../../session/workflow";
import { enrichFeedbackRequest } from "../../session/workflowLogic";
import type { SessionPhase } from "../../session/workflowLogic";
import {
  resolveResearchMarketId,
  transitionAfterGetMarketPrice,
  transitionAfterGetMarkets,
  transitionAfterWebResearch,
} from "../../session/workflowTransitions";
import { executeTool } from "../../tools/execute";
import type { ToolCall } from "../../types/schemas";
import type { ToolExecutorConfig, ToolResponse } from "../../types/tools";
import {
  formatResearchChatContent,
  parseResearchMarkdown,
} from "../../shared/chatPresentation";
import { emitChatMessage, emitUiEvent, summarizeToolResultData } from "../emit";
import type { WorkflowRunContext } from "./context";

function phaseBlockedToolResult(
  tool: string,
  phase: SessionPhase,
): ToolResponse<unknown> {
  const allowed = allowedToolsForPhase(phase);
  return {
    status: "error",
    message: `Tool "${tool}" is not allowed in phase ${phase}.`,
    data: null,
    error: {
      name: "PHASE_TOOL_BLOCKED",
      details: JSON.stringify({ phase, allowedTools: allowed }),
    },
  };
}

function graphEmitState(ctx: WorkflowRunContext) {
  return {
    onEvent: ctx.onEvent ?? null,
    sessionId: ctx.sessionId,
    wakeTraceId: ctx.wakeTraceId,
    userId: ctx.userId,
  };
}

export async function requestOperatorFeedback(
  ctx: WorkflowRunContext,
  toolCall: ToolCall,
): Promise<never> {
  const sessionId = ctx.sessionId;
  let workflow = await getSessionWorkflow(sessionId);

  const metadata = toolCall.metadata as {
    type: "mcq" | "text" | "mcq_or_custom" | "multi_select";
    question: string;
    options?: string[];
    minSelections?: number;
    maxSelections?: number;
  };

  if (workflow.phase === "APPROVE") {
    workflow = await updateSessionWorkflow(sessionId, (current) => ({
      ...current,
      approvalReason: toolCall.reason,
    }));
  }

  const feedback = enrichFeedbackRequest(workflow.phase, metadata, workflow);
  const pending = {
    ...createPendingFeedback({
      type: feedback.type,
      question: feedback.question,
      options: feedback.options,
      minSelections: feedback.minSelections,
      maxSelections: feedback.maxSelections,
      reason: toolCall.reason,
    }),
    phase: workflow.phase,
  };
  await savePendingFeedback(sessionId, pending);

  emitUiEvent(
    graphEmitState(ctx),
    "feedback-request",
    {
      requestId: pending.requestId,
      type: pending.type,
      question: pending.question,
      options: pending.options,
      minSelections: pending.minSelections,
      maxSelections: pending.maxSelections,
      reason: pending.reason,
      phase: workflow.phase,
    },
    sessionId,
  );

  emitChatMessage(
    graphEmitState(ctx),
    "bot",
    pending.question,
    workflow.phase === "DECIDE"
      ? "Waiting for your final market selection"
      : "Waiting for your input",
    sessionId,
  );

  throw new AwaitingFeedbackError(pending.requestId);
}

export async function executeWorkflowToolCall(
  ctx: WorkflowRunContext,
  toolCall: ToolCall,
): Promise<void> {
  if (shouldTripCircuitBreaker(ctx.failureCount)) {
    throw new CircuitBreakerError(ctx.failureCount);
  }

  const sessionId = ctx.sessionId;
  let workflow = await getSessionWorkflow(sessionId);

  debugLog("orchestrator.tool-call", "Executing tool", {
    sessionId,
    userId: ctx.userId,
    wakeTraceId: ctx.wakeTraceId,
    tool: toolCall.tool,
    phase: workflow.phase,
  });

  logEvent(
    "graph.tool",
    {
      id: randomUUID(),
      sessionId,
      timestamp: new Date().toISOString(),
      kind: "tool-call",
      payload: {
        wakeTraceId: ctx.wakeTraceId,
        tool: toolCall.tool,
        phase: workflow.phase,
        reason: toolCall.reason,
        metadata: toolCall.metadata as Record<string, unknown>,
        orchestrator: true,
      },
    },
    {
      sessionId,
      userId: ctx.userId,
      wakeTraceId: ctx.wakeTraceId,
      published: false,
    },
  );

  if (!isToolAllowedInPhase(workflow.phase, toolCall.tool)) {
    const blocked = phaseBlockedToolResult(toolCall.tool, workflow.phase);
    logEvent(
      "graph.tool",
      {
        id: randomUUID(),
        sessionId,
        timestamp: new Date().toISOString(),
        kind: "tool-result",
        payload: {
          wakeTraceId: ctx.wakeTraceId,
          tool: toolCall.tool,
          phase: workflow.phase,
          status: blocked.status,
          message: blocked.message,
          orchestrator: true,
        },
      },
      {
        sessionId,
        userId: ctx.userId,
        wakeTraceId: ctx.wakeTraceId,
        published: false,
      },
    );
    return;
  }

  if (toolCall.tool === "request_feedback") {
    await requestOperatorFeedback(ctx, toolCall);
    return;
  }

  const toolConfig =
    toolCall.tool === "web_research"
      ? ({
          ...(toolCall.metadata as Record<string, unknown>),
          depth: workflow.phase === "BACKGROUND" ? "deep" : "quick",
        } as ToolExecutorConfig)
      : (toolCall.metadata as ToolExecutorConfig);
  const result = await executeTool(toolCall.tool, toolConfig);

  logEvent(
    "graph.tool",
    {
      id: randomUUID(),
      sessionId,
      timestamp: new Date().toISOString(),
      kind: "tool-result",
      payload: {
        wakeTraceId: ctx.wakeTraceId,
        tool: toolCall.tool,
        phase: workflow.phase,
        status: result.status,
        message: result.message,
        error: result.status === "error" ? result.error : undefined,
        dataPreview:
          result.status === "success"
            ? summarizeToolResultData(toolCall.tool, result.data)
            : undefined,
        orchestrator: true,
      },
    },
    {
      sessionId,
      userId: ctx.userId,
      wakeTraceId: ctx.wakeTraceId,
      published: false,
    },
  );

  if (result.status === "error") {
    debugError("orchestrator.tool-result", `Tool ${toolCall.tool} failed`, {
      sessionId,
      userId: ctx.userId,
      wakeTraceId: ctx.wakeTraceId,
      tool: toolCall.tool,
      errorDetails: result.error?.details,
    });
    ctx.failureCount = incrementFailureCount(ctx.failureCount, true);

    if (toolCall.tool === "web_research") {
      const gate = await recordResearchFailure(sessionId);
      const guidance = researchRetryRequiredMessage(gate);
      emitChatMessage(
        graphEmitState(ctx),
        "bot",
        result.message || "Web research failed.",
        guidance ?? "web_research · failed",
        sessionId,
      );
      if (guidance) {
        logInfo("orchestrator.research", guidance, { sessionId });
      }
    }
  } else if (toolCall.tool === "get-markets") {
    const fetchedCount =
      result.data &&
      typeof result.data === "object" &&
      Array.isArray((result.data as { markets?: unknown[] }).markets)
        ? (result.data as { markets: unknown[] }).markets.length
        : 0;

    workflow = await updateSessionWorkflow(sessionId, (current) =>
      transitionAfterGetMarkets(current, result.data),
    );
    const shortlistCount = workflow.shortlist?.length ?? 0;
    emitChatMessage(
      graphEmitState(ctx),
      "bot",
      shortlistCount > 0
        ? `Loaded ${shortlistCount} active markets for shortlist review.`
        : `Fetched ${fetchedCount} market(s), but none were eligible for the shortlist.`,
      "get-markets · discovery complete",
      sessionId,
    );
  } else if (toolCall.tool === "web_research") {
    await recordResearchSuccess(sessionId);

    const researchMetadata = toolCall.metadata as { topic: string };
    const cookie = await getResearchCookie(sessionId);
    const marketId = resolveResearchMarketId(
      workflow,
      cookie,
      workflow.phase === "BACKGROUND"
        ? workflow.chosen?.marketId ?? workflow.userSpec?.targetMarketId
        : undefined,
    );
    const researchText =
      typeof result.data === "string" ? result.data : JSON.stringify(result.data, null, 2);

    if (marketId) {
      await appendResearchEntry(sessionId, {
        marketId,
        topic: researchMetadata.topic,
        intent:
          workflow.phase === "BACKGROUND"
            ? "Detailed Tavily background research"
            : "Tavily web research",
        mcpTool: "tavily",
        summary: researchText.slice(0, 8000),
        searchedAt: new Date().toISOString(),
      });
    }

    const nextCookie = await getResearchCookie(sessionId);
    workflow = await updateSessionWorkflow(sessionId, (current) =>
      transitionAfterWebResearch(current, nextCookie),
    );

    const researchPresentation = parseResearchMarkdown(
      researchText,
      researchMetadata.topic,
    );
    if (marketId) {
      researchPresentation.marketId = marketId;
    }

    emitChatMessage(
      graphEmitState(ctx),
      "bot",
      formatResearchChatContent(researchPresentation),
      workflow.phase === "BACKGROUND"
        ? "Detailed Tavily background saved to session research cookie"
        : "web_research · findings saved to session research cookie",
      sessionId,
      {
        contentKind: "research-summary",
        contentData: researchPresentation as unknown as Record<string, unknown>,
      },
    );
  } else if (toolCall.tool === "get-market-price") {
    const priceMetadata = toolCall.metadata as { tokenId: string };
    workflow = await updateSessionWorkflow(sessionId, (current) =>
      transitionAfterGetMarketPrice(current, priceMetadata.tokenId),
    );
    emitChatMessage(
      graphEmitState(ctx),
      "bot",
      `Fetched price for token ${priceMetadata.tokenId}.`,
      "get-market-price · ready for approval",
      sessionId,
    );
  }

  if (shouldTripCircuitBreaker(ctx.failureCount)) {
    throw new CircuitBreakerError(ctx.failureCount);
  }
}
