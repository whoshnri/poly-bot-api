import { describe, expect, test } from "bun:test";
import { aiModelResponseSchema } from "./schemas";

describe("model tool schema", () => {
  test("accepts phased workflow tools", () => {
    const result = aiModelResponseSchema.safeParse({
      message: "Loading active markets.",
      reasoning: "Need discovery first.",
      isTradeActive: false,
      toolCalls: [
        {
          tool: "get-markets",
          reason: "Find active markets.",
          metadata: { limit: 10 },
        },
      ],
      nextStage: {
        summary: "Discovering markets.",
        todo: "Review search results.",
        stageAction: null,
        stageActionData: null,
      },
    });

    expect(result.success).toBe(true);
  });

  test("rejects deprecated discovery tools", () => {
    const result = aiModelResponseSchema.safeParse({
      message: "Fetching markets.",
      reasoning: "Legacy tool path.",
      isTradeActive: false,
      toolCalls: [
        {
          tool: "public-search",
          reason: "Should not be allowed.",
          metadata: { q: "legacy" },
        },
      ],
      nextStage: {
        summary: "Bad tool call.",
        todo: "Retry.",
        stageAction: null,
        stageActionData: null,
      },
    });

    expect(result.success).toBe(false);
  });
});
