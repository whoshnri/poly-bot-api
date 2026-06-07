import { describe, expect, test } from "bun:test";
import { scoreDiscoverMarkets, type DiscoverMarketHit } from "./scoring";

describe("scoreDiscoverMarkets", () => {
  test("ranks topic overlap and volume ahead of weak matches", () => {
    const hits: DiscoverMarketHit[] = [
      {
        marketId: "m1",
        question: "Will Bitcoin reach 150k in 2026?",
        eventTitle: "Bitcoin 2026",
        volume: 500_000,
        liquidity: 20_000,
        query: "bitcoin price",
        active: true,
      },
      {
        marketId: "m2",
        question: "Will a random celebrity win an award?",
        eventTitle: "Awards",
        volume: 50,
        liquidity: 10,
        query: "bitcoin price",
        active: true,
      },
      {
        marketId: "m1",
        question: "Will Bitcoin reach 150k in 2026?",
        eventTitle: "Bitcoin 2026",
        volume: 500_000,
        liquidity: 20_000,
        query: "btc prediction",
        active: true,
      },
    ];

    const ranked = scoreDiscoverMarkets(hits, "bitcoin 2026", 5);
    expect(ranked[0]?.marketId).toBe("m1");
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });

  test("deduplicates by market id", () => {
    const hits: DiscoverMarketHit[] = [
      {
        marketId: "m1",
        question: "Market one",
        query: "a",
        active: true,
      },
      {
        marketId: "m1",
        question: "Market one duplicate",
        query: "b",
        active: true,
      },
    ];

    expect(scoreDiscoverMarkets(hits, "market", 10)).toHaveLength(1);
  });
});
