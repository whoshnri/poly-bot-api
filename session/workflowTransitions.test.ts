import { describe, expect, test } from "bun:test";
import {
  extractCandidatesFromMarkets,
  transitionAfterGetMarketPrice,
  transitionAfterGetMarkets,
  transitionAfterWebResearch,
} from "./workflowTransitions";
import { upsertResearchEntry } from "./researchCookieLogic";

describe("extractCandidatesFromMarkets", () => {
  test("extracts active, tradable markets", () => {
    const candidates = extractCandidatesFromMarkets({
      markets: [
        {
          id: "m1",
          question: "Will X win?",
          active: true,
          acceptingOrders: true,
          closed: false,
          outcomes: [{ name: "Yes", tokenId: "t1" }],
        },
        {
          id: "m2",
          question: "Closed market",
          active: false,
          closed: true,
          outcomes: [],
        },
        {
          id: "m3",
          question: "Geo-restricted but tradable for configured accounts",
          active: true,
          acceptingOrders: true,
          closed: false,
          restricted: true,
          outcomes: [{ name: "Yes", tokenId: "t3" }],
        },
      ],
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.marketId).toBe("m1");
    expect(candidates[0]?.tokenIds).toEqual(["t1"]);
    expect(candidates[1]?.marketId).toBe("m3");
  });
});

describe("transitionAfterGetMarkets", () => {
  test("moves DISCOVER to SHORTLIST with shortlist", () => {
    const next = transitionAfterGetMarkets(
      { phase: "DISCOVER", userSpec: { topic: "celebrity", source: "prompt" } },
      {
        markets: [
          {
            id: "m1",
            question: "Q1",
            active: true,
            acceptingOrders: true,
            closed: false,
            outcomes: [],
          },
        ],
      },
    );

    expect(next.phase).toBe("SHORTLIST");
    expect(next.shortlist).toHaveLength(1);
  });
});

describe("transitionAfterWebResearch", () => {
  test("moves RESEARCH to DECIDE when all selected markets are researched", () => {
    const cookie = upsertResearchEntry({}, {
      marketId: "m1",
      topic: "t",
      intent: "i",
      mcpTool: "search_web",
      summary: "s",
      searchedAt: "2026-05-31T00:00:00.000Z",
    });

    const next = transitionAfterWebResearch(
      {
        phase: "RESEARCH",
        shortlist: [{ marketId: "m1", question: "Q1" }],
        selectedMarketIds: ["m1"],
      },
      cookie,
    );

    expect(next.phase).toBe("DECIDE");
  });

  test("moves BACKGROUND to PRICE when final market research is complete", () => {
    const cookie = upsertResearchEntry({}, {
      marketId: "m1",
      topic: "t",
      intent: "detailed",
      mcpTool: "search_web",
      summary: "s",
      searchedAt: "2026-05-31T00:00:00.000Z",
    });

    const next = transitionAfterWebResearch(
      {
        phase: "BACKGROUND",
        chosen: { marketId: "m1", tokenId: "t1", side: "BUY", thesis: "" },
      },
      cookie,
    );

    expect(next.phase).toBe("PRICE");
  });
});

describe("transitionAfterGetMarketPrice", () => {
  test("moves PRICE to APPROVE", () => {
    const next = transitionAfterGetMarketPrice(
      {
        phase: "PRICE",
        chosen: {
          marketId: "m1",
          tokenId: "old",
          side: "BUY",
          thesis: "test",
        },
      },
      "t-new",
    );

    expect(next.phase).toBe("APPROVE");
    expect(next.chosen?.tokenId).toBe("t-new");
  });
});
