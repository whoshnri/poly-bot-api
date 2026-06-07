import { debugLog } from "../../shared/log";
import { ensureChosenTokenId } from "../../session/marketTokens";
import {
  applyFeedbackToWorkflow,
  getSessionWorkflow,
  updateSessionWorkflow,
} from "../../session/workflow";
import { publishBotSleep } from "../../session/events";
import {
  getResearchGate,
  MAX_RESEARCH_ATTEMPTS,
  recordUserConsultedAfterResearchFailure,
} from "../../session/researchGate";
import type { FeedbackContinuation } from "../../types/graph";
import type { WorkflowRunContext } from "./context";

export type FeedbackContinuationResult = {
  botSleepRequested: boolean;
  stopReason?: string;
  stageActionComplete?: boolean;
  pivotInstruction?: string;
};

export async function applyFeedbackContinuation(
  ctx: WorkflowRunContext,
  continuation: FeedbackContinuation,
): Promise<FeedbackContinuationResult> {
  debugLog("orchestrator.feedback", "Applying feedback continuation", {
    sessionId: ctx.sessionId,
    userId: ctx.userId,
    requestId: continuation.requestId,
  });

  const sessionId = ctx.sessionId;
  const gate = await getResearchGate(sessionId);
  if (gate.researchAttempts >= MAX_RESEARCH_ATTEMPTS && !gate.researchSucceeded) {
    await recordUserConsultedAfterResearchFailure(sessionId);
  }

  const currentWorkflow = await getSessionWorkflow(sessionId);
  const feedbackResolution = applyFeedbackToWorkflow(
    currentWorkflow,
    continuation.answer,
  );
  let nextWorkflow = feedbackResolution.workflow;
  if (nextWorkflow.phase === "BACKGROUND" || nextWorkflow.phase === "PRICE") {
    nextWorkflow = await ensureChosenTokenId(nextWorkflow);
  }
  await updateSessionWorkflow(sessionId, () => nextWorkflow);

  if (
    nextWorkflow.phase === "SLEEP" &&
    nextWorkflow.operatorDecision === "reject"
  ) {
    const reason =
      "You declined the trade proposal. The bot is sleeping — no order was placed.";
    publishBotSleep(sessionId, reason, {
      resumeable: true,
      operatorDecision: "reject",
    });

    return {
      botSleepRequested: true,
      stopReason: reason,
      stageActionComplete: true,
    };
  }

  if (feedbackResolution.pivotInstruction) {
    ctx.userInstruction = feedbackResolution.pivotInstruction;
  }

  return {
    botSleepRequested: false,
    pivotInstruction: feedbackResolution.pivotInstruction,
  };
}
