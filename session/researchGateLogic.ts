export const MAX_RESEARCH_ATTEMPTS = 2;

export type ResearchGateState = {
  researchAttempts: number;
  researchSucceeded: boolean;
  userConsultedAfterResearchFailure: boolean;
  researchComplete: boolean;
};

export function canStartTrade(gate: ResearchGateState): {
  allowed: boolean;
  reason?: string;
} {
  if (gate.researchComplete) {
    return { allowed: true };
  }

  if (
    gate.researchAttempts >= MAX_RESEARCH_ATTEMPTS &&
    !gate.userConsultedAfterResearchFailure
  ) {
    return {
      allowed: false,
      reason:
        "Research is incomplete. web_research failed twice — use request_feedback to ask the operator for direction, then form a clear YES/NO thesis before START_TRADE.",
    };
  }

  if (gate.researchAttempts === 0) {
    return {
      allowed: false,
      reason:
        "Research is incomplete. Run web_research before trading so you can justify YES vs NO.",
    };
  }

  return {
    allowed: false,
    reason:
      "Research is incomplete. Finish web_research (retry once if needed) or consult the operator via request_feedback before START_TRADE.",
  };
}

export function researchRetryRequiredMessage(gate: ResearchGateState): string | null {
  if (gate.researchSucceeded || gate.researchComplete) {
    return null;
  }

  if (gate.researchAttempts === 1) {
    return "web_research failed once. Retry web_research exactly one more time with a refined topic before consulting the operator.";
  }

  if (
    gate.researchAttempts >= MAX_RESEARCH_ATTEMPTS &&
    !gate.userConsultedAfterResearchFailure
  ) {
    return "web_research has failed twice. You MUST call request_feedback to ask the operator for direction. Do not START_TRADE until you have a clear thesis.";
  }

  return null;
}
