/**
 * Trade token resolution for Polymarket sessions.
 *
 * Gamma `marketId` (e.g. "1105745") is not a CLOB token. Pricing and orders require the
 * outcome `tokenId` from Gamma `clobTokenIds` / outcome rows (typically the "Yes" leg).
 *
 * Resolution order (use `requireTradeTokenId` at execution boundaries):
 * 1. Explicit `preferredTokenId` on chosen market
 * 2. `tokenIds` already stored on shortlist / pre-session payload
 * 3. Gamma `getMarketById(marketId)` lookup
 */
import { getMarketById } from "../polymarket";
import { logInfo } from "../shared/log";
import type { EssentialGammaMarket, TradableMarketOutcome } from "../types/polymarket";
import type { MarketCandidate, SessionWorkflowState } from "./workflowLogic";

export class MissingTradeTokenIdError extends Error {
  readonly marketId: string;

  constructor(marketId: string) {
    super(
      `No CLOB token ID found for market ${marketId}. ` +
        "Resolve it with requireTradeTokenId(marketId) — Gamma must expose clobTokenIds for this market.",
    );
    this.name = "MissingTradeTokenIdError";
    this.marketId = marketId;
  }
}

export function extractTokenIdsFromOutcomes(
  outcomes: TradableMarketOutcome[] | undefined,
): string[] {
  if (!outcomes) {
    return [];
  }

  return outcomes
    .map((outcome) => outcome.tokenId?.trim())
    .filter((tokenId): tokenId is string => Boolean(tokenId));
}

export function extractTokenIdsFromGammaMarket(market: EssentialGammaMarket): string[] {
  return extractTokenIdsFromOutcomes(market.outcomes);
}

/** First tradable token on a shortlist row — the usual "Yes" leg for BUY workflows. */
export function primaryTokenIdFromCandidate(
  candidate: Pick<MarketCandidate, "marketId" | "tokenIds">,
): string | null {
  return candidate.tokenIds?.find((tokenId) => tokenId.trim().length > 0) ?? null;
}

export function mergeTokenIdsIntoShortlist(
  shortlist: MarketCandidate[] | undefined,
  byMarketId: Map<string, string[]>,
): MarketCandidate[] | undefined {
  if (!shortlist) {
    return shortlist;
  }

  return shortlist.map((candidate) => {
    const incoming = byMarketId.get(candidate.marketId);
    if (!incoming || incoming.length === 0) {
      return candidate;
    }

    const merged = [...(candidate.tokenIds ?? [])];
    for (const tokenId of incoming) {
      if (!merged.includes(tokenId)) {
        merged.push(tokenId);
      }
    }

    return { ...candidate, tokenIds: merged };
  });
}

export async function fetchGammaMarketsById(
  marketIds: string[],
  existing: Map<string, EssentialGammaMarket> = new Map(),
): Promise<Map<string, EssentialGammaMarket>> {
  const result = new Map(existing);

  await Promise.all(
    marketIds.map(async (marketId) => {
      if (result.has(marketId)) {
        return;
      }

      try {
        const market = await getMarketById({ marketId });
        result.set(marketId, market);
      } catch {
        // Caller handles missing markets.
      }
    }),
  );

  return result;
}

export function tokenIdsByMarketIdFromGamma(
  gammaMarkets: Map<string, EssentialGammaMarket>,
): Map<string, string[]> {
  const byMarketId = new Map<string, string[]>();
  for (const [marketId, market] of gammaMarkets) {
    const tokenIds = extractTokenIdsFromGammaMarket(market);
    if (tokenIds.length > 0) {
      byMarketId.set(marketId, tokenIds);
    }
  }
  return byMarketId;
}

export async function resolveTokenIdForMarket(
  marketId: string,
  existingTokenIds?: string[],
): Promise<string | null> {
  const fromList = existingTokenIds?.find((tokenId) => tokenId.trim().length > 0);
  if (fromList) {
    return fromList;
  }

  try {
    const market = await getMarketById({ marketId });
    const tokenIds = extractTokenIdsFromGammaMarket(market);
    if (tokenIds.length > 0) {
      logInfo("marketTokens.resolve", "Resolved trade token from Gamma", {
        marketId,
        tokenId: tokenIds[0],
        source: "gamma-getMarketById",
      });
    }
    return tokenIds[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Canonical async resolver — call this before get-market-price or order placement.
 * Throws MissingTradeTokenIdError when Gamma has no token for the market.
 */
export async function requireTradeTokenId(params: {
  marketId: string;
  knownTokenIds?: string[];
  preferredTokenId?: string;
}): Promise<string> {
  const preferred = params.preferredTokenId?.trim();
  if (preferred) {
    return preferred;
  }

  const fromKnown = params.knownTokenIds?.find((tokenId) => tokenId.trim().length > 0);
  if (fromKnown) {
    return fromKnown;
  }

  const resolved = await resolveTokenIdForMarket(params.marketId);
  if (!resolved) {
    throw new MissingTradeTokenIdError(params.marketId);
  }

  return resolved;
}

export async function enrichWorkflowTradeTokens(
  workflow: SessionWorkflowState,
): Promise<SessionWorkflowState> {
  const shortlist = workflow.shortlist ?? [];
  const marketIdsNeedingLookup = new Set<string>();

  for (const candidate of shortlist) {
    if (!primaryTokenIdFromCandidate(candidate)) {
      marketIdsNeedingLookup.add(candidate.marketId);
    }
  }

  if (workflow.chosen?.marketId && !workflow.chosen.tokenId.trim()) {
    marketIdsNeedingLookup.add(workflow.chosen.marketId);
  }

  if (marketIdsNeedingLookup.size === 0) {
    return workflow;
  }

  const gammaMarkets = await fetchGammaMarketsById([...marketIdsNeedingLookup]);
  const tokenIdsByMarketId = tokenIdsByMarketIdFromGamma(gammaMarkets);

  let next: SessionWorkflowState = {
    ...workflow,
    shortlist: mergeTokenIdsIntoShortlist(workflow.shortlist, tokenIdsByMarketId),
  };

  if (next.chosen?.marketId && !next.chosen.tokenId.trim()) {
    const shortlistMatch = next.shortlist?.find(
      (candidate) => candidate.marketId === next.chosen!.marketId,
    );
    const tokenId = await requireTradeTokenId({
      marketId: next.chosen.marketId,
      knownTokenIds: shortlistMatch?.tokenIds,
      preferredTokenId: next.chosen.tokenId,
    }).catch(() => null);

    if (tokenId) {
      next = {
        ...next,
        shortlist: mergeTokenIdsIntoShortlist(
          next.shortlist,
          new Map([[next.chosen.marketId, [tokenId]]]),
        ),
        chosen: { ...next.chosen, tokenId },
      };
    }
  }

  return next;
}

/** Ensures workflow.chosen.tokenId is set when a focus market is selected. */
export async function ensureChosenTokenId(
  workflow: SessionWorkflowState,
): Promise<SessionWorkflowState> {
  const chosen = workflow.chosen;
  if (!chosen?.marketId) {
    return workflow;
  }

  if (chosen.tokenId.trim().length > 0) {
    return workflow;
  }

  const shortlistMatch = workflow.shortlist?.find(
    (candidate) => candidate.marketId === chosen.marketId,
  );

  const tokenId = await requireTradeTokenId({
    marketId: chosen.marketId,
    knownTokenIds: shortlistMatch?.tokenIds,
  }).catch(() => null);

  if (!tokenId) {
    return workflow;
  }

  return {
    ...workflow,
    shortlist: mergeTokenIdsIntoShortlist(
      workflow.shortlist,
      new Map([[chosen.marketId, [tokenId]]]),
    ),
    chosen: { ...chosen, tokenId },
  };
}

export type DiscoverMarketWithTokens = {
  marketId: string;
  tokenIds?: string[];
};

/** Backfill tokenIds on discover results before explore hands off to a session. */
export async function enrichDiscoverMarketsWithTokenIds<
  T extends DiscoverMarketWithTokens,
>(markets: T[]): Promise<T[]> {
  const missing = markets.filter((market) => !primaryTokenIdFromCandidate(market));
  if (missing.length === 0) {
    return markets;
  }

  const gammaMarkets = await fetchGammaMarketsById(missing.map((market) => market.marketId));
  const tokenIdsByMarketId = tokenIdsByMarketIdFromGamma(gammaMarkets);

  return markets.map((market) => {
    if (primaryTokenIdFromCandidate(market)) {
      return market;
    }

    const tokenIds = tokenIdsByMarketId.get(market.marketId);
    if (!tokenIds || tokenIds.length === 0) {
      return market;
    }

    return { ...market, tokenIds };
  });
}
