import { describe, expect, test } from "bun:test";
import {
  formatResearchChatContent,
  parseResearchMarkdown,
} from "./chatPresentation";

describe("parseResearchMarkdown", () => {
  test("extracts topic and sources from research markdown", () => {
    const parsed = parseResearchMarkdown(
      [
        "# Web research: Will the Fed hike?",
        "## Search results",
        "1. Odds jump on prediction markets - CNBC",
        "   URL: https://www.cnbc.com/example",
        "   Score: 0.9850",
        "   Snippet: Chances shot up this week.",
      ].join("\n"),
      "Will the Fed hike?",
    );

    expect(parsed.topic).toBe("Will the Fed hike?");
    expect(parsed.sources).toHaveLength(1);
    expect(parsed.sources[0]?.title).toContain("CNBC");
    expect(parsed.sources[0]?.url).toBe("https://www.cnbc.com/example");
    expect(parsed.sources[0]?.score).toBeCloseTo(0.985);
  });
});

describe("formatResearchChatContent", () => {
  test("builds concise chat copy", () => {
    const content = formatResearchChatContent({
      marketId: "906976",
      topic: "Will the Fed hike?",
      sources: [{ title: "CNBC story", url: "https://example.com" }],
    });

    expect(content).toContain("906976");
    expect(content).toContain("CNBC story");
    expect(content).not.toContain("# Web research");
  });
});
