import { describe, expect, test } from "bun:test";
import {
  canStartTrade,
  researchRetryRequiredMessage,
  MAX_RESEARCH_ATTEMPTS,
  type ResearchGateState,
} from "./researchGateLogic";

const fresh: ResearchGateState = {
  researchAttempts: 0,
  researchSucceeded: false,
  userConsultedAfterResearchFailure: false,
  researchComplete: false,
};

describe("canStartTrade", () => {
  test("blocks when no research attempted", () => {
    const result = canStartTrade(fresh);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("web_research");
  });

  test("blocks after one failed attempt", () => {
    const result = canStartTrade({ ...fresh, researchAttempts: 1 });
    expect(result.allowed).toBe(false);
  });

  test("blocks after two failures without user consult", () => {
    const result = canStartTrade({ ...fresh, researchAttempts: MAX_RESEARCH_ATTEMPTS });
    expect(result.allowed).toBe(false);
  });

  test("allows after successful research", () => {
    const result = canStartTrade({
      ...fresh,
      researchSucceeded: true,
      researchComplete: true,
    });
    expect(result.allowed).toBe(true);
  });

  test("allows after user consulted post-research-failure", () => {
    const result = canStartTrade({
      ...fresh,
      researchAttempts: MAX_RESEARCH_ATTEMPTS,
      userConsultedAfterResearchFailure: true,
      researchComplete: true,
    });
    expect(result.allowed).toBe(true);
  });
});

describe("researchRetryRequiredMessage", () => {
  test("prompts retry after first failure", () => {
    const msg = researchRetryRequiredMessage({ ...fresh, researchAttempts: 1 });
    expect(msg).toContain("Retry web_research");
  });

  test("requires feedback after second failure", () => {
    const msg = researchRetryRequiredMessage({ ...fresh, researchAttempts: MAX_RESEARCH_ATTEMPTS });
    expect(msg).toContain("request_feedback");
  });

  test("returns null when research complete", () => {
    expect(researchRetryRequiredMessage({ ...fresh, researchComplete: true })).toBeNull();
  });
});
