import { describe, expect, test } from "bun:test";
import { ensureActionableModelResponse, shouldRunDeterministicTools } from "./phaseExecution";

describe("phaseExecution", () => {
  test("shouldRunDeterministicTools covers tool-driven phases", () => {
    expect(shouldRunDeterministicTools("RESEARCH")).toBe(true);
    expect(shouldRunDeterministicTools("DISCOVER")).toBe(true);
    expect(shouldRunDeterministicTools("SHORTLIST")).toBe(false);
    expect(shouldRunDeterministicTools("APPROVE")).toBe(false);
  });

  test("ensureActionableModelResponse injects phase fallback for chat-only output", () => {
    const result = ensureActionableModelResponse(
      {
        message: "Got your picks!",
        reasoning: "Moving to research.",
        isTradeActive: false,
        toolCalls: [],
        nextStage: {
          summary: "Shortlist complete",
          todo: "Research markets",
          stageAction: null,
          stageActionData: null,
        },
      },
      { phase: "RESEARCH", searchQuery: "Will X happen?" },
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.tool).toBe("web_research");
    expect(result.toolCalls[0]?.metadata).toEqual({ topic: "Will X happen?" });
  });
});
