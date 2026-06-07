export type DiscoverMarketHit = {
  marketId: string;
  question: string;
  eventTitle?: string;
  tokenIds?: string[];
  volume?: number;
  liquidity?: number;
  query: string;
  active: boolean;
};

export type ScoredDiscoverMarket = {
  marketId: string;
  question: string;
  eventTitle?: string;
  tokenIds?: string[];
  score: number;
  volume?: number;
  liquidity?: number;
};

function tokenOverlapScore(text: string, topic: string): number {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3);

  const topicTokens = new Set(normalize(topic));
  if (topicTokens.size === 0) {
    return 0;
  }

  const haystack = normalize(text);
  let matches = 0;
  for (const token of haystack) {
    if (topicTokens.has(token)) {
      matches += 1;
    }
  }
  return matches / topicTokens.size;
}

function volumeScore(volume?: number): number {
  if (!volume || volume <= 0) {
    return 0;
  }
  return Math.min(Math.log10(volume + 1) / 6, 1);
}

function liquidityScore(liquidity?: number): number {
  if (!liquidity || liquidity <= 0) {
    return 0;
  }
  return Math.min(Math.log10(liquidity + 1) / 5, 1);
}

export function scoreDiscoverMarkets(
  hits: DiscoverMarketHit[],
  topic: string,
  limit = 10,
): ScoredDiscoverMarket[] {
  const byId = new Map<string, DiscoverMarketHit & { queries: Set<string> }>();

  for (const hit of hits) {
    const existing = byId.get(hit.marketId);
    if (!existing) {
      byId.set(hit.marketId, { ...hit, queries: new Set([hit.query]) });
      continue;
    }

    existing.queries.add(hit.query);
    existing.volume = Math.max(existing.volume ?? 0, hit.volume ?? 0);
    existing.liquidity = Math.max(existing.liquidity ?? 0, hit.liquidity ?? 0);
    if (hit.tokenIds && hit.tokenIds.length > 0) {
      const merged = new Set([...(existing.tokenIds ?? []), ...hit.tokenIds]);
      existing.tokenIds = [...merged];
    }
  }

  const scored = [...byId.values()].map((hit) => {
    const text = `${hit.question} ${hit.eventTitle ?? ""}`;
    const overlap = tokenOverlapScore(text, topic);
    const volume = volumeScore(hit.volume);
    const liquidity = liquidityScore(hit.liquidity);
    const queryBoost = Math.min(hit.queries.size / 3, 1) * 0.15;
    const activeBoost = hit.active ? 0.05 : 0;

    const score = overlap * 0.45 + volume * 0.25 + liquidity * 0.15 + queryBoost + activeBoost;

    return {
      marketId: hit.marketId,
      question: hit.question,
      eventTitle: hit.eventTitle,
      tokenIds: hit.tokenIds,
      volume: hit.volume,
      liquidity: hit.liquidity,
      score: Number(score.toFixed(4)),
    } satisfies ScoredDiscoverMarket;
  });

  return scored.sort((left, right) => right.score - left.score).slice(0, limit);
}
