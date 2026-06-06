import { z } from "zod";
import type { EssentialGammaMarket } from "../types/polymarket";

export interface NormalizedMarket {
  id: string;
  question: string;
  marketProbability: number;
  liquidity: number;
  volume: number;
  spread: number;
  closesAt: string;
}

export interface AIEstimate {
  marketId: string;
  aiProbability: number;
  confidence: number;
  reasoning: string;
}

export interface ScoredMarket extends NormalizedMarket, AIEstimate {
  edge: number;
  adjustedProbability: number;
  ev: number;
  worthy: boolean;
}

export const AIEstimateSchema = z.object({
  marketId: z.string(),
  aiProbability: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(200),
});

export type SessionScoringState = {
  estimates: Record<string, AIEstimate>;
  scoredMarkets: ScoredMarket[];
  opportunities: ScoredMarket[];
};

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function clampProbability(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function normalizeMarketFromGamma(market: EssentialGammaMarket): NormalizedMarket {
  const yesOutcome = market.outcomes[0];
  const marketProbability = clampProbability(toFiniteNumber(yesOutcome?.price, 0));
  const bestBid = toFiniteNumber(market.bestBid, marketProbability);
  const bestAsk = toFiniteNumber(market.bestAsk, marketProbability);
  const spread = Math.max(0, bestAsk - bestBid);

  return {
    id: market.id,
    question: market.question?.trim() || `Market ${market.id}`,
    marketProbability,
    liquidity: toFiniteNumber(market.liquidity ?? market.liquidityClob, 0),
    volume: toFiniteNumber(market.volume ?? market.volume24hr ?? market.volumeClob, 0),
    spread,
    closesAt: market.endDate?.trim() || "",
  };
}

export function failedEstimate(marketId: string, reason = "Estimate unavailable due to invalid model output."): AIEstimate {
  return {
    marketId,
    aiProbability: 0,
    confidence: 0,
    reasoning: reason.slice(0, 200),
  };
}

function normalizeUnitInterval(value: unknown): number | null {
  const parsed = toFiniteNumber(value, Number.NaN);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (parsed > 1 && parsed <= 100) {
    return clampProbability(parsed / 100);
  }

  if (parsed < 0 || parsed > 1) {
    return null;
  }

  return parsed;
}

function unwrapEstimateRecord(parsed: unknown): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
    return record.data as Record<string, unknown>;
  }
  if (record.result && typeof record.result === "object" && !Array.isArray(record.result)) {
    return record.result as Record<string, unknown>;
  }
  if (record.estimate && typeof record.estimate === "object" && !Array.isArray(record.estimate)) {
    return record.estimate as Record<string, unknown>;
  }

  return record;
}

export function normalizeEstimateRecord(
  record: Record<string, unknown>,
  marketId: string,
): AIEstimate | null {
  const aiProbability = normalizeUnitInterval(
    record.aiProbability ??
      record.probability ??
      record.yesProbability ??
      record.yes_probability ??
      record.p,
  );
  const confidence = normalizeUnitInterval(
    record.confidence ??
      record.confidenceScore ??
      record.confidence_score ??
      record.certainty,
  );

  if (aiProbability === null || confidence === null) {
    return null;
  }

  const reasoningRaw = record.reasoning ?? record.reason ?? record.explanation ?? record.summary;
  const reasoning =
    typeof reasoningRaw === "string" && reasoningRaw.trim().length > 0
      ? reasoningRaw.trim().slice(0, 200)
      : "Model provided probabilities without reasoning.";

  return {
    marketId,
    aiProbability,
    confidence,
    reasoning,
  };
}

export function extractJsonPayload(rawText: string): string {
  const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
    throw new Error("Model output did not include a JSON object.");
  }

  return rawText.slice(firstBrace, lastBrace + 1).trim();
}

export function parseAIEstimateFromModel(rawText: string, marketId: string): AIEstimate {
  try {
    const parsed = JSON.parse(extractJsonPayload(rawText)) as unknown;
    const record = unwrapEstimateRecord(parsed);
    if (!record) {
      return failedEstimate(marketId, "Model output was not a JSON object.");
    }

    const normalized = normalizeEstimateRecord({ ...record, marketId }, marketId);
    if (normalized) {
      const validated = AIEstimateSchema.safeParse(normalized);
      if (validated.success) {
        return validated.data;
      }
    }
  } catch {
    // Fall through to failed estimate.
  }

  return failedEstimate(marketId);
}

export function calcEdge(market: NormalizedMarket, estimate: AIEstimate): ScoredMarket {
  const rawEdge = estimate.aiProbability - market.marketProbability;
  const adjustedProbability =
    estimate.aiProbability * estimate.confidence +
    market.marketProbability * (1 - estimate.confidence);
  const edge = rawEdge * estimate.confidence;
  const ev =
    adjustedProbability * (1 - market.marketProbability) -
    (1 - adjustedProbability) * market.marketProbability;
  const worthy =
    Math.abs(edge) > 0.06 &&
    estimate.confidence > 0.65 &&
    ev > 0 &&
    market.liquidity > 1000;

  return {
    ...market,
    ...estimate,
    edge,
    adjustedProbability,
    ev,
    worthy,
  };
}

export function scoreMarkets(
  markets: NormalizedMarket[],
  estimates: Record<string, AIEstimate>,
): ScoredMarket[] {
  return markets
    .map((market) => {
      const estimate = estimates[market.id] ?? failedEstimate(market.id);
      return calcEdge(market, estimate);
    })
    .sort((left, right) => {
      if (left.ev !== right.ev) {
        return left.ev - right.ev;
      }
      return Math.abs(right.edge) - Math.abs(left.edge);
    });
}

export function filterOpportunities(scoredMarkets: ScoredMarket[]): ScoredMarket[] {
  return scoredMarkets.filter((market) => market.worthy);
}

function readMetadataRecord(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }
  return metadata as Record<string, unknown>;
}

function isScoredMarket(value: unknown): value is ScoredMarket {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.marketId === "string" &&
    typeof record.ev === "number" &&
    typeof record.worthy === "boolean"
  );
}

function isAIEstimate(value: unknown): value is AIEstimate {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.marketId === "string" &&
    typeof record.aiProbability === "number" &&
    typeof record.confidence === "number" &&
    typeof record.reasoning === "string"
  );
}

export function readSessionScoring(metadata: unknown): SessionScoringState | null {
  const root = readMetadataRecord(metadata).scoring;
  if (!root || typeof root !== "object") {
    return null;
  }

  const record = root as Record<string, unknown>;
  const scoredMarkets = Array.isArray(record.scoredMarkets)
    ? record.scoredMarkets.filter(isScoredMarket)
    : [];
  const opportunities = Array.isArray(record.opportunities)
    ? record.opportunities.filter(isScoredMarket)
    : [];

  const estimates: Record<string, AIEstimate> = {};
  if (record.estimates && typeof record.estimates === "object") {
    for (const [marketId, estimate] of Object.entries(
      record.estimates as Record<string, unknown>,
    )) {
      if (isAIEstimate(estimate)) {
        estimates[marketId] = estimate;
      }
    }
  }

  if (scoredMarkets.length === 0 && opportunities.length === 0 && Object.keys(estimates).length === 0) {
    return null;
  }

  return {
    estimates,
    scoredMarkets,
    opportunities,
  };
}

export function formatOpportunitiesForPrompt(opportunities: ScoredMarket[]): string {
  if (opportunities.length === 0) {
    return [
      "Deterministic scoring found no worthy opportunities.",
      "Present this result to the operator and use request_feedback to decide next steps.",
      "Do not invent or re-score markets.",
    ].join("\n");
  }

  const lines = opportunities.map((market, index) => {
    const side = market.edge > 0 ? "BUY YES" : "BUY NO";
    return [
      `${index + 1}. ${market.question}`,
      `   marketId: ${market.id}`,
      `   marketProbability: ${market.marketProbability.toFixed(3)}`,
      `   aiProbability: ${market.aiProbability.toFixed(3)}`,
      `   edge: ${market.edge.toFixed(3)} (${side})`,
      `   ev: ${market.ev.toFixed(4)}`,
      `   confidence: ${market.confidence.toFixed(2)}`,
      `   reasoning: ${market.reasoning}`,
    ].join("\n");
  });

  return [
    "Deterministic scoring opportunities (sorted by EV ascending):",
    "Present these exactly as scored. Do not re-evaluate, override, or invent new analysis.",
    "Your only job is to format this for the operator and call request_feedback.",
    "",
    ...lines,
  ].join("\n");
}

export function serializeOpportunitiesForEvent(
  opportunities: ScoredMarket[],
): Record<string, unknown>[] {
  return opportunities.map((market) => ({
    id: market.id,
    question: market.question,
    marketProbability: market.marketProbability,
    aiProbability: market.aiProbability,
    edge: market.edge,
    ev: market.ev,
    confidence: market.confidence,
    reasoning: market.reasoning,
    worthy: market.worthy,
    liquidity: market.liquidity,
    closesAt: market.closesAt,
  }));
}
