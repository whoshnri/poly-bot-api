import { describe, expect, test } from "bun:test";
import { buildPreSessionHandoffMessage } from "./preSessionHandoff";

describe("buildPreSessionHandoffMessage", () => {
  test("includes selected market question and topic", () => {
    const message = buildPreSessionHandoffMessage(
      "Will Bitcoin hit $100k in 2026?",
      "crypto markets",
    );

    expect(message).toContain("Will Bitcoin hit $100k in 2026?");
    expect(message).toContain("crypto markets");
    expect(message).toContain("Tavily research");
  });

  test("works without topic", () => {
    const message = buildPreSessionHandoffMessage("Election winner 2028");

    expect(message).toContain("Election winner 2028");
    expect(message).not.toContain("about **");
  });
});
