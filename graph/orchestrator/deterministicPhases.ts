import { logInfo } from "../../shared/log";
import { getResearchCookie } from "../../session/researchCookie";
import { listResearchedMarketIds } from "../../session/researchCookieLogic";
import { getSessionWorkflow } from "../../session/workflow";
import { resolveResearchMarketId } from "../../session/workflowTransitions";
import type { ToolCall } from "../../types/schemas";
import { emitChatMessage } from "../emit";
import { buildModelRecoveryContext } from "../model/phaseExecution";
import { buildPhaseFallbackTool } from "../model/recoveryContext";
import type { WorkflowRunContext } from "./context";
import { executeWorkflowToolCall, requestOperatorFeedback } from "./toolRunner";

function asToolCall(
  toolCall: ReturnType<typeof buildPhaseFallbackTool>,
): ToolCall {
  return toolCall as ToolCall;
}

async function runPhaseTool(ctx: WorkflowRunContext): Promise<void> {
  const workflow = await getSessionWorkflow(ctx.sessionId);
  const recoveryContext = buildModelRecoveryContext(workflow, ctx);
  const toolCall = asToolCall(buildPhaseFallbackTool(recoveryContext));

  logInfo("orchestrator.phase", "Running deterministic phase tool", {
    sessionId: ctx.sessionId,
    phase: workflow.phase,
    tool: toolCall.tool,
  });

  await executeWorkflowToolCall(ctx, toolCall);
}

export async function runDiscoverPhase(ctx: WorkflowRunContext): Promise<void> {
  const workflow = await getSessionWorkflow(ctx.sessionId);
  if (workflow.phase !== "DISCOVER") {
    return;
  }

  await runPhaseTool(ctx);

  const nextWorkflow = await getSessionWorkflow(ctx.sessionId);
  if (nextWorkflow.phase !== "SHORTLIST") {
    throw new Error(
      "No tradable markets were found for the shortlist. Discovery returned results, but none could be added.",
    );
  }
}

export async function requestShortlistFeedback(ctx: WorkflowRunContext): Promise<void> {
  const workflow = await getSessionWorkflow(ctx.sessionId);
  if (workflow.phase !== "SHORTLIST") {
    throw new Error(
      `Expected SHORTLIST phase before presenting market selection (current: ${workflow.phase}).`,
    );
  }

  await requestOperatorFeedback(ctx, {
    tool: "request_feedback",
    reason: "The operator needs to select markets from the shortlist before research can begin.",
    metadata: {
      type: "multi_select",
      question: "Pick one or more markets to research next.",
      minSelections: 1,
    },
  });
}

export async function runResearchLoop(ctx: WorkflowRunContext): Promise<void> {
  while (true) {
    const workflow = await getSessionWorkflow(ctx.sessionId);
    if (workflow.phase !== "RESEARCH") {
      return;
    }

    const cookie = await getResearchCookie(ctx.sessionId);
    const marketId = resolveResearchMarketId(workflow, cookie);
    const topic =
      workflow.shortlist?.find((candidate) => candidate.marketId === marketId)?.question ??
      workflow.userSpec?.topic ??
      "selected market";
    const selectedMarketIds = workflow.selectedMarketIds ?? [];
    const researchedCount = listResearchedMarketIds(cookie).filter((id) =>
      selectedMarketIds.includes(id),
    ).length;
    const progressLabel =
      selectedMarketIds.length > 0
        ? `${researchedCount + 1} of ${selectedMarketIds.length}`
        : `${researchedCount + 1}`;

    emitChatMessage(
      {
        onEvent: ctx.onEvent ?? null,
        sessionId: ctx.sessionId,
        wakeTraceId: ctx.wakeTraceId,
        userId: ctx.userId,
      },
      "bot",
      `Researching market ${progressLabel}: ${topic}`,
      "web_research · in progress",
      ctx.sessionId,
    );

    await runPhaseTool(ctx);
  }
}

export async function runBackgroundPhase(ctx: WorkflowRunContext): Promise<void> {
  const workflow = await getSessionWorkflow(ctx.sessionId);
  if (workflow.phase !== "BACKGROUND") {
    return;
  }

  const topic =
    workflow.shortlist?.find(
      (candidate) => candidate.marketId === workflow.chosen?.marketId,
    )?.question ??
    workflow.userSpec?.topic ??
    "chosen market";

  emitChatMessage(
    {
      onEvent: ctx.onEvent ?? null,
      sessionId: ctx.sessionId,
      wakeTraceId: ctx.wakeTraceId,
      userId: ctx.userId,
    },
    "bot",
    `Gathering detailed background research: ${topic}`,
    "web_research · in progress",
    ctx.sessionId,
  );

  await runPhaseTool(ctx);
}

export async function runPricePhase(ctx: WorkflowRunContext): Promise<void> {
  const workflow = await getSessionWorkflow(ctx.sessionId);
  if (workflow.phase !== "PRICE") {
    return;
  }

  await runPhaseTool(ctx);
}
