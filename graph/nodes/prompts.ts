import { buildPhaseAwareInitializationPrompt, buildPhaseAwareWakePrompt } from "../../session/workflowPrompts";
import { debugLog } from "../../shared/log";
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
import type { TradingGraphNodeState } from "../../types/graph";
import { ensureSessionId } from "../persist";
import { createServerMessage } from "../messages";

export async function loadWakePromptNode(state: TradingGraphNodeState) {
  if (!state.sessionId) {
    throw new Error("load-wake-prompt requires sessionId.");
  }

  const prompt = await buildPhaseAwareWakePrompt(state.sessionId);
  debugLog("graph.node", "load-wake-prompt", {
    sessionId: state.sessionId,
    userId: state.userId,
  });
  return {
    prompt,
    messages: [createServerMessage(prompt)],
  };
}

export async function loadInitializationPromptNode(state: TradingGraphNodeState) {
  const instruction = state.userInstruction.trim();
  const sessionId = state.sessionId ?? (await ensureSessionId(null, state.userId));
  const prompt = await buildPhaseAwareInitializationPrompt(
    sessionId,
    instruction || "Explore Polymarket opportunities conservatively.",
  );
  debugLog("graph.node", "load-init-prompt", {
    sessionId,
    userId: state.userId,
    instructionLength: instruction.length,
  });
  return {
    sessionId,
    prompt,
    messages: [createServerMessage(prompt)],
  };
}

export async function loadFeedbackContinuationNode(state: TradingGraphNodeState) {
  const continuation = state.feedbackContinuation;
  if (!continuation) {
    throw new Error("load-feedback-continuation requires feedbackContinuation.");
  }

  debugLog("graph.node", "load-feedback-continuation", {
    sessionId: state.sessionId,
    userId: state.userId,
    requestId: continuation.requestId,
  });

  const sessionId = state.sessionId ?? (await ensureSessionId(null, state.userId));
  const gate = await getResearchGate(sessionId);
  if (gate.researchAttempts >= MAX_RESEARCH_ATTEMPTS && !gate.researchSucceeded) {
    await recordUserConsultedAfterResearchFailure(sessionId);
  }

  const currentWorkflow = await getSessionWorkflow(sessionId);
  const feedbackResolution = applyFeedbackToWorkflow(
    currentWorkflow,
    continuation.answer,
  );
  const nextWorkflow = feedbackResolution.workflow;
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
      sessionId,
      botSleepRequested: true,
      stopReason: reason,
      stageActionComplete: true,
      messages: [
        createServerMessage(
          JSON.stringify({
            kind: "operator-feedback",
            decision: "reject",
            workflowPhase: nextWorkflow.phase,
          }),
        ),
      ],
    };
  }

  return {
    sessionId,
    userInstruction: feedbackResolution.pivotInstruction ?? state.userInstruction,
    messages: [
      createServerMessage(
        JSON.stringify({
          kind: "tool-result",
          tool: "request_feedback",
          result: {
            status: "success",
            message: "Operator feedback received.",
            data: {
              requestId: continuation.requestId,
              formattedAnswer: continuation.formattedAnswer,
              answer: continuation.answer,
              workflowPhase: nextWorkflow.phase,
              operatorDecision: nextWorkflow.operatorDecision ?? null,
            },
          },
        }),
      ),
    ],
  };
}
