import { describe, expect, test } from "bun:test";
import { buildRecoveryPayload, normalizeModelPayload } from "./normalize";
import { buildPhaseFallbackTool } from "./recoveryContext";

describe("normalizeModelPayload", () => {
  test("normalizes web-research tool alias", () => {
    const result = normalizeModelPayload({
      message: "hi",
      reasoning: "test",
      isTradeActive: false,
      toolCalls: [{ tool: "web-research", reason: "research", metadata: { topic: "x" } }],
      nextStage: { summary: "s", todo: "t", stageAction: null, stageActionData: null },
    }) as Record<string, unknown>;

    const calls = result.toolCalls as Array<{ tool: string; metadata: { topic: string } }>;
    expect(calls[0]?.tool).toBe("web_research");
    expect(calls[0]?.metadata.topic).toBe("x");
  });

  test("does not inject approval options for SHORTLIST feedback missing options", () => {
    const result = normalizeModelPayload(
      {
        message: "Pick markets",
        reasoning: "Need operator input",
        isTradeActive: false,
        toolCalls: [
          {
            tool: "request_feedback",
            reason: "shortlist",
            metadata: {
              type: "multi_select",
              question: "Please select up to 10 markets you would like to shortlist for further research:",
            },
          },
        ],
        nextStage: { summary: "s", todo: "t", stageAction: null, stageActionData: null },
      },
      { phase: "SHORTLIST" },
    ) as Record<string, unknown>;

    const calls = result.toolCalls as Array<{ metadata: { type: string; options?: string[] } }>;
    expect(calls[0]?.metadata.type).toBe("multi_select");
    expect(calls[0]?.metadata.options).toBeUndefined();
  });

  test("injects approval options only in APPROVE phase", () => {
    const result = normalizeModelPayload(
      {
        message: "Approve?",
        reasoning: "Ready",
        isTradeActive: true,
        toolCalls: [
          {
            tool: "request_feedback",
            reason: "approval",
            metadata: {
              type: "mcq",
              question: "Proceed with the trade?",
            },
          },
        ],
        nextStage: { summary: "s", todo: "t", stageAction: null, stageActionData: null },
      },
      { phase: "APPROVE" },
    ) as Record<string, unknown>;

    const calls = result.toolCalls as Array<{ metadata: { options: string[] } }>;
    expect(calls[0]?.metadata.options).toEqual(["Yes, place order", "No, cancel"]);
  });

  test("fills missing nextStage strings", () => {
    const result = normalizeModelPayload({
      message: "Continue",
      reasoning: "Because",
      isTradeActive: false,
      toolCalls: [],
      nextStage: {},
    }) as Record<string, unknown>;

    const nextStage = result.nextStage as { summary: string; todo: string };
    expect(nextStage.summary.length).toBeGreaterThan(0);
    expect(nextStage.todo.length).toBeGreaterThan(0);
  });
});

describe("buildRecoveryPayload", () => {
  test("adds fallback get-markets for DISCOVER", () => {
    const recovered = buildRecoveryPayload({}, {
      searchQuery: "celebrity news",
      phase: "DISCOVER",
    }) as Record<string, unknown>;
    const calls = recovered.toolCalls as unknown[];
    expect(calls.length).toBeGreaterThan(0);
    expect((calls[0] as { tool: string }).tool).toBe("get-markets");
    expect((calls[0] as { metadata: { limit: number } }).metadata.limit).toBe(10);
  });

  test("adds fallback web_research for RESEARCH", () => {
    const recovered = buildRecoveryPayload({}, {
      searchQuery: "celebrities",
      phase: "RESEARCH",
      shortlistMarketId: "m1",
    }) as Record<string, unknown>;
    const calls = recovered.toolCalls as Array<{ tool: string; metadata: { topic: string } }>;
    expect(calls[0]?.tool).toBe("web_research");
    expect(calls[0]?.metadata.topic).toBe("celebrities");
  });

  test("clears premature stageAction during recovery", () => {
    const recovered = buildRecoveryPayload({
      nextStage: { summary: "s", todo: "t", stageAction: "START_TRADE", stageActionData: {} },
    }) as Record<string, unknown>;
    const nextStage = recovered.nextStage as { stageAction: string | null };
    expect(nextStage.stageAction).toBeNull();
  });
});

describe("buildPhaseFallbackTool", () => {
  test("returns request_feedback for SPEC", () => {
    const tool = buildPhaseFallbackTool({ phase: "SPEC" });
    expect(tool.tool).toBe("request_feedback");
  });
});
