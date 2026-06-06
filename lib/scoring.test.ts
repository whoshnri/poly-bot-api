import { describe, expect, test } from "bun:test";
import {
  calcEdge,
  failedEstimate,
  filterOpportunities,
  normalizeEstimateRecord,
  parseAIEstimateFromModel,
  scoreMarkets,
  type NormalizedMarket,
} from "./scoring";

const baseMarket: NormalizedMarket = {
  id: "market-1",
  question: "Will event happen?",
  marketProbability: 0.4,
  liquidity: 5000,
  volume: 12000,
  spread: 0.02,
  closesAt: "2026-12-31T00:00:00Z",
};

describe("calcEdge", () => {
  test("computes edge, adjusted probability, ev, and worthy flag", () => {
    const estimate = {
      marketId: "market-1",
      aiProbability: 0.62,
      confidence: 0.8,
      reasoning: "Recent polls lean yes.",
    };

    const scored = calcEdge(baseMarket, estimate);

    expect(scored.edge).toBeCloseTo(0.176, 3);
    expect(scored.adjustedProbability).toBeCloseTo(0.576, 3);
    expect(scored.ev).toBeCloseTo(0.176, 3);
    expect(scored.worthy).toBe(true);
  });

  test("marks low-confidence estimates as not worthy", () => {
    const scored = calcEdge(baseMarket, {
      marketId: "market-1",
      aiProbability: 0.9,
      confidence: 0.4,
      reasoning: "Thin context.",
    });

    expect(scored.worthy).toBe(false);
  });
});

describe("scoreMarkets", () => {
  test("sorts by ev ascending and uses failed estimate when missing", () => {
    const markets: NormalizedMarket[] = [
      { ...baseMarket, id: "a", marketProbability: 0.3 },
      { ...baseMarket, id: "b", marketProbability: 0.5 },
    ];

    const estimates = {
      a: {
        marketId: "a",
        aiProbability: 0.7,
        confidence: 0.9,
        reasoning: "Strong signal.",
      },
      b: failedEstimate("b"),
    };

    const scored = scoreMarkets(markets, estimates);
    expect(scored).toHaveLength(2);
    expect(scored[0]?.id).toBe("b");
    expect(scored[0]?.confidence).toBe(0);
  });
});

describe("filterOpportunities", () => {
  test("returns only worthy markets", () => {
    const scored = scoreMarkets(
      [baseMarket, { ...baseMarket, id: "market-2", liquidity: 100 }],
      {
        "market-1": {
          marketId: "market-1",
          aiProbability: 0.62,
          confidence: 0.8,
          reasoning: "Strong signal.",
        },
        "market-2": {
          marketId: "market-2",
          aiProbability: 0.9,
          confidence: 0.9,
          reasoning: "Also strong.",
        },
      },
    );

    const opportunities = filterOpportunities(scored);
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]?.id).toBe("market-1");
  });
});

describe("parseAIEstimateFromModel", () => {
  test("accepts decimal probabilities", () => {
    const estimate = parseAIEstimateFromModel(
      JSON.stringify({
        marketId: "m1",
        aiProbability: 0.08,
        confidence: 0.72,
        reasoning: "Recent reporting leans yes.",
      }),
      "m1",
    );

    expect(estimate.aiProbability).toBeCloseTo(0.08);
    expect(estimate.confidence).toBeCloseTo(0.72);
  });

  test("normalizes percentage-style probabilities", () => {
    const estimate = parseAIEstimateFromModel(
      JSON.stringify({
        aiProbability: 8,
        confidence: 72,
        reasoning: "Percent output.",
      }),
      "m1",
    );

    expect(estimate.aiProbability).toBeCloseTo(0.08);
    expect(estimate.confidence).toBeCloseTo(0.72);
  });

  test("unwraps nested estimate payloads", () => {
    const estimate = parseAIEstimateFromModel(
      JSON.stringify({
        data: {
          probability: 0.15,
          confidenceScore: 0.66,
          reason: "Nested payload.",
        },
      }),
      "m1",
    );

    expect(estimate.aiProbability).toBeCloseTo(0.15);
    expect(estimate.confidence).toBeCloseTo(0.66);
  });

  test("returns failed estimate for invalid output", () => {
    const estimate = parseAIEstimateFromModel("not json", "m1");
    expect(estimate.confidence).toBe(0);
    expect(estimate.aiProbability).toBe(0);
  });
});

describe("normalizeEstimateRecord", () => {
  test("maps alternate field names", () => {
    const estimate = normalizeEstimateRecord(
      {
        yes_probability: 0.21,
        certainty: 0.55,
        explanation: "Alternate keys.",
      },
      "m9",
    );

    expect(estimate?.marketId).toBe("m9");
    expect(estimate?.aiProbability).toBeCloseTo(0.21);
    expect(estimate?.confidence).toBeCloseTo(0.55);
  });
});
