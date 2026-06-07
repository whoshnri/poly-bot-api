import { getPendingFeedback, type PendingFeedback } from "./feedback";
import { getSessionWorkflow, type SessionPhase, type SessionWorkflowState } from "./workflow";

export type SessionResumeMode =
  | "awaiting_feedback"
  | "continue"
  | "sleeping"
  | "complete"
  | "idle";

const JUST_STARTED_MS = 30_000;
const EARLY_PHASES: SessionPhase[] = ["SPEC", "DISCOVER"];

export type SessionResumeState = {
  canContinue: boolean;
  mode: SessionResumeMode;
  phase: SessionPhase;
  message: string;
  justStarted?: boolean;
};

export type SessionResumeOptions = {
  createdAt?: Date;
};

function phaseResumeMessage(phase: SessionPhase, workflow: SessionWorkflowState): string {
  switch (phase) {
    case "DISCOVER":
      return "Continue market discovery from where you left off.";
    case "SHORTLIST":
      return "Continue and pick markets from the shortlist.";
    case "RESEARCH": {
      const selected = workflow.selectedMarketIds?.length ?? 0;
      return selected > 0
        ? `Continue Tavily research on ${selected} selected market${selected === 1 ? "" : "s"}.`
        : "Continue research on the selected markets.";
    }
    case "DECIDE":
      return "Continue scoring and pick a final market.";
    case "BACKGROUND":
      return "Continue detailed background research on the chosen market.";
    case "PRICE":
      return "Continue by fetching the latest market price.";
    case "APPROVE":
      return "Continue to the trade approval step.";
    case "SPEC":
      return "Continue setup — the bot still needs your direction.";
    case "EXECUTE":
      return "Trade execution is in progress.";
    case "SLEEP":
      return "Session is paused.";
    default:
      return "Continue this session.";
  }
}

export async function getSessionResumeState(sessionId: string): Promise<SessionResumeState> {
  const [workflow, pending] = await Promise.all([
    getSessionWorkflow(sessionId),
    getPendingFeedback(sessionId),
  ]);

  return buildSessionResumeState(workflow, pending);
}

function isJustStarted(workflow: SessionWorkflowState, options?: SessionResumeOptions): boolean {
  if (!options?.createdAt) {
    return false;
  }

  const ageMs = Date.now() - options.createdAt.getTime();
  return ageMs >= 0 && ageMs < JUST_STARTED_MS && EARLY_PHASES.includes(workflow.phase);
}

export function buildSessionResumeState(
  workflow: SessionWorkflowState,
  pending: PendingFeedback | null,
  options?: SessionResumeOptions,
): SessionResumeState {
  const justStarted = isJustStarted(workflow, options);

  if (pending) {
    return {
      canContinue: true,
      mode: "awaiting_feedback",
      phase: workflow.phase,
      message: "Answer the pending question to continue.",
    };
  }

  if (workflow.phase === "SLEEP") {
    return {
      canContinue: true,
      mode: "sleeping",
      phase: workflow.phase,
      message:
        workflow.operatorDecision === "reject"
          ? "Session paused after you declined a trade. Send a new instruction to pivot."
          : "Session is sleeping. Send a new instruction to wake it.",
    };
  }

  if (workflow.phase === "EXECUTE") {
    return {
      canContinue: false,
      mode: "complete",
      phase: workflow.phase,
      message: "Trade execution has started.",
    };
  }

  const continuablePhases: SessionPhase[] = [
    "SPEC",
    "DISCOVER",
    "SHORTLIST",
    "RESEARCH",
    "DECIDE",
    "BACKGROUND",
    "PRICE",
    "APPROVE",
  ];

  if (continuablePhases.includes(workflow.phase)) {
    if (justStarted) {
      return {
        canContinue: false,
        mode: "idle",
        phase: workflow.phase,
        message: "Session is starting — the bot will pick up automatically.",
        justStarted: true,
      };
    }

    return {
      canContinue: true,
      mode: "continue",
      phase: workflow.phase,
      message: phaseResumeMessage(workflow.phase, workflow),
    };
  }

  return {
    canContinue: false,
    mode: "idle",
    phase: workflow.phase,
    message: "Nothing to continue right now.",
  };
}
