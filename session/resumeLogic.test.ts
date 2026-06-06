import { describe, expect, test } from "bun:test";
import { buildSessionResumeState } from "./resumeLogic";

describe("buildSessionResumeState", () => {
  test("marks pending feedback as awaiting_feedback", () => {
    const state = buildSessionResumeState(
      { phase: "SHORTLIST", shortlist: [] },
      {
        requestId: "req-1",
        type: "multi_select",
        question: "Pick markets",
        options: ["a"],
        reason: "test",
        createdAt: new Date().toISOString(),
      },
    );

    expect(state.mode).toBe("awaiting_feedback");
    expect(state.canContinue).toBe(true);
  });

  test("allows continue during RESEARCH", () => {
    const state = buildSessionResumeState(
      {
        phase: "RESEARCH",
        selectedMarketIds: ["m1", "m2"],
      },
      null,
    );

    expect(state.mode).toBe("continue");
    expect(state.canContinue).toBe(true);
    expect(state.message).toContain("2 selected markets");
  });

  test("marks sleeping sessions as continuable with new instruction", () => {
    const state = buildSessionResumeState(
      { phase: "SLEEP", operatorDecision: "reject" },
      null,
    );

    expect(state.mode).toBe("sleeping");
    expect(state.canContinue).toBe(true);
  });
});
