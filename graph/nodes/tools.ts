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
import {
  formatResearchChatContent,
  parseResearchMarkdown,
} from "../../shared/chatPresentation";
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
import type { AiGraphMessage, TradingGraphNodeState } from "../../types/graph";
import { emitChatMessage, emitUiEvent, summarizeToolResultData } from "../emit";
import { ensureSessionId } from "../persist";
import { createServerMessage } from "../messages";

function toolExecutorConfigForCall(toolCall: ToolCall): ToolExecutorConfig {
  return toolCall.metadata as ToolExecutorConfig;
}

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

export async function runToolCallsNode(state: TradingGraphNodeState) {
  if (shouldTripCircuitBreaker(state.failureCount)) {
    throw new CircuitBreakerError(state.failureCount);
  }

  if (!state.aiResponse) {
    throw new Error("Cannot run tool calls without an AI response.");
  }

  const toolCalls = state.aiResponse.toolCalls;
  if (toolCalls.length === 0) {
    return {};
  }

  logInfo("graph.node", "run-tool-calls started", {
    sessionId: state.sessionId,
    userId: state.userId,
    wakeTraceId: state.wakeTraceId,
    toolCallCount: toolCalls.length,
    tools: toolCalls.map((call) => call.tool),
  });

  const sessionId = await ensureSessionId(state.sessionId, state.userId);
  let workflow = await getSessionWorkflow(sessionId);
  const results: ToolResponse<unknown>[] = [];
  const serverMessages: AiGraphMessage[] = [];
  let failureDelta = 0;

  for (const toolCall of toolCalls) {
    debugLog("graph.tool-call", "Executing tool", {
      sessionId,
      userId: state.userId,
      wakeTraceId: state.wakeTraceId,
      tool: toolCall.tool,
      phase: workflow.phase,
      reason: toolCall.reason,
      metadata: toolCall.metadata,
    });

    logEvent(
      "graph.tool",
      {
        id: randomUUID(),
        sessionId,
        timestamp: new Date().toISOString(),
        kind: "tool-call",
        payload: {
          wakeTraceId: state.wakeTraceId,
          tool: toolCall.tool,
          phase: workflow.phase,
          reason: toolCall.reason,
          metadata: toolCall.metadata as Record<string, unknown>,
        },
      },
      {
        sessionId,
        userId: state.userId,
        wakeTraceId: state.wakeTraceId,
        published: false,
      },
    );

    if (!isToolAllowedInPhase(workflow.phase, toolCall.tool)) {
      const blocked = phaseBlockedToolResult(toolCall.tool, workflow.phase);
      results.push(blocked);
      serverMessages.push(
        createServerMessage(
          JSON.stringify({
            kind: "tool-result",
            tool: toolCall.tool,
            result: blocked,
          }),
        ),
      );
      continue;
    }

    if (toolCall.tool === "request_feedback") {
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

      const pending = createPendingFeedback({
        type: feedback.type,
        question: feedback.question,
        options: feedback.options,
        minSelections: feedback.minSelections,
        maxSelections: feedback.maxSelections,
        reason: toolCall.reason,
      });
      await savePendingFeedback(sessionId, pending);

      emitUiEvent(
        state,
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
        state,
        "bot",
        pending.question,
        "Waiting for your input",
        sessionId,
      );

      throw new AwaitingFeedbackError(pending.requestId);
    }

    const toolConfig =
      toolCall.tool === "web_research"
        ? ({
            ...(toolCall.metadata as Record<string, unknown>),
            depth: workflow.phase === "BACKGROUND" ? "deep" : "quick",
          } as ToolExecutorConfig)
        : toolExecutorConfigForCall(toolCall);

    const result = await executeTool(toolCall.tool, toolConfig);

    logEvent(
      "graph.tool",
      {
        id: randomUUID(),
        sessionId,
        timestamp: new Date().toISOString(),
        kind: "tool-result",
        payload: {
          wakeTraceId: state.wakeTraceId,
          tool: toolCall.tool,
          phase: workflow.phase,
          status: result.status,
          message: result.message,
          error: result.status === "error" ? result.error : undefined,
          dataPreview:
            result.status === "success"
              ? summarizeToolResultData(toolCall.tool, result.data)
              : undefined,
        },
      },
      {
        sessionId,
        userId: state.userId,
        wakeTraceId: state.wakeTraceId,
        published: false,
      },
    );

    if (result.status === "error") {
      debugError("graph.tool-result", `Tool ${toolCall.tool} failed`, {
        sessionId,
        userId: state.userId,
        wakeTraceId: state.wakeTraceId,
        tool: toolCall.tool,
        errorDetails: result.error?.details,
      });
      failureDelta = incrementFailureCount(failureDelta, true);

      if (toolCall.tool === "web_research") {
        const gate = await recordResearchFailure(sessionId);
        const guidance = researchRetryRequiredMessage(gate);
        if (guidance) {
          serverMessages.push(createServerMessage(guidance));
        }
      }
    } else if (toolCall.tool === "get-markets") {
      workflow = await updateSessionWorkflow(sessionId, (current) =>
        transitionAfterGetMarkets(current, result.data),
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
        state,
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
    } else if (toolCall.tool === "get-market-by-id") {
      const marketMetadata = toolCall.metadata as { marketId: string };
      workflow = await updateSessionWorkflow(sessionId, (current) => ({
        ...current,
        userSpec: {
          source: current.userSpec?.source ?? "prompt",
          topic: current.userSpec?.topic,
          targetMarketId: marketMetadata.marketId,
        },
        chosen: current.chosen
          ? { ...current.chosen, marketId: marketMetadata.marketId }
          : {
              marketId: marketMetadata.marketId,
              tokenId: "",
              side: "BUY" as const,
              thesis: "",
            },
      }));
    } else if (toolCall.tool === "get-market-price") {
      const priceMetadata = toolCall.metadata as { tokenId: string };
      workflow = await updateSessionWorkflow(sessionId, (current) =>
        transitionAfterGetMarketPrice(current, priceMetadata.tokenId),
      );
    }

    if (shouldTripCircuitBreaker(state.failureCount + failureDelta)) {
      throw new CircuitBreakerError(state.failureCount + failureDelta);
    }

    results.push(result as ToolResponse<unknown>);
    serverMessages.push(
      createServerMessage(
        JSON.stringify({
          kind: "tool-result",
          tool: toolCall.tool,
          result,
          workflowPhase: workflow.phase,
        }),
      ),
    );
  }

  return {
    sessionId,
    toolResults: results,
    messages: serverMessages,
    ...(failureDelta > 0 ? { failureCount: failureDelta } : {}),
  };
}
