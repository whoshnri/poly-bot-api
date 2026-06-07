import { describe, expect, test } from "bun:test";
import { buildSessionNameFromPreSession } from "./sessionLabel";

describe("buildSessionNameFromPreSession", () => {
  test("prefers market question over topic", () => {
    expect(
      buildSessionNameFromPreSession("crypto", "Will Bitcoin hit $100k?"),
    ).toBe("Will Bitcoin hit $100k?");
  });

  test("falls back to topic", () => {
    expect(buildSessionNameFromPreSession("US election odds")).toBe("US election odds");
  });

  test("truncates long labels", () => {
    const longQuestion =
      "Will the Federal Reserve cut interest rates before the end of 2026?";
    const label = buildSessionNameFromPreSession("rates", longQuestion);
    expect(label.length).toBeLessThanOrEqual(48);
    expect(label.endsWith("…")).toBe(true);
  });
});
