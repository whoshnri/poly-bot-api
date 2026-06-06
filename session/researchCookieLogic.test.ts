import { describe, expect, test } from "bun:test";
import {
  listResearchedMarketIds,
  readResearchCookie,
  summarizeResearchCookie,
  upsertResearchEntry,
} from "./researchCookieLogic";

const sampleEntry = {
  marketId: "m1",
  topic: "Celebrity divorce",
  intent: "Assess YES on market m1",
  mcpTool: "search_web",
  summary: "Recent reports suggest settlement talks.",
  searchedAt: "2026-05-31T12:00:00.000Z",
};

describe("readResearchCookie", () => {
  test("returns empty cookie for missing metadata", () => {
    expect(readResearchCookie(null)).toEqual({});
  });

  test("reads valid entries and ignores malformed rows", () => {
    const cookie = readResearchCookie({
      researchCookie: {
        m1: [sampleEntry, { marketId: "bad" }],
      },
    });

    expect(cookie.m1).toHaveLength(1);
    expect(cookie.m1?.[0]?.summary).toContain("settlement");
  });
});

describe("upsertResearchEntry", () => {
  test("appends entries per marketId", () => {
    const first = upsertResearchEntry({}, sampleEntry);
    const second = upsertResearchEntry(first, {
      ...sampleEntry,
      summary: "Updated angle on the same market.",
      searchedAt: "2026-05-31T12:05:00.000Z",
    });

    expect(first.m1).toHaveLength(1);
    expect(second.m1).toHaveLength(2);
  });
});

describe("research cookie helpers", () => {
  test("listResearchedMarketIds returns markets with entries", () => {
    const cookie = upsertResearchEntry({}, sampleEntry);
    expect(listResearchedMarketIds(cookie)).toEqual(["m1"]);
  });

  test("summarizeResearchCookie includes latest intent", () => {
    const cookie = upsertResearchEntry({}, sampleEntry);
    const summary = summarizeResearchCookie(cookie);
    expect(summary).toContain("m1");
    expect(summary).toContain(sampleEntry.intent);
  });
});
