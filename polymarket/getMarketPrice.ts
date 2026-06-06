import { getMarkets } from "./getMarkets";
import type {
  GetMarketPriceParams,
  MarketPriceResponse,
} from "../types/polymarket";

export const DEFAULT_CLOB_API_URL = "https://clob.polymarket.com";

function parsePrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

async function getGammaReferencePrice(
  tokenId: string,
  side: GetMarketPriceParams["side"],
): Promise<{ price: number; note: string } | null> {
  const { markets } = await getMarkets({
    clobTokenIds: [tokenId],
    limit: 1,
  });
  const market = markets[0];
  if (!market) {
    return null;
  }

  const outcome = market.outcomes.find((entry) => entry.tokenId === tokenId);
  if (typeof outcome?.price === "number" && Number.isFinite(outcome.price)) {
    return {
      price: outcome.price,
      note: "Gamma outcomePrices reference (no CLOB orderbook).",
    };
  }

  const sidePrice =
    side === "BUY" ? market.bestAsk ?? market.bestBid : market.bestBid ?? market.bestAsk;
  if (typeof sidePrice === "number" && Number.isFinite(sidePrice)) {
    return {
      price: sidePrice,
      note: `Gamma ${side === "BUY" ? "bestAsk/bestBid" : "bestBid/bestAsk"} reference (no CLOB orderbook).`,
    };
  }

  return null;
}

/**
 * Fetches current best market price for a token/side pair.
 * Falls back to Gamma reference prices when the CLOB has no orderbook.
 */
export async function getMarketPrice({
  tokenId,
  side,
  clobApiUrl = DEFAULT_CLOB_API_URL,
  signal,
}: GetMarketPriceParams): Promise<MarketPriceResponse> {
  if (!tokenId.trim()) {
    throw new Error("tokenId is required.");
  }

  const url = new URL("/price", clobApiUrl);
  url.searchParams.set("token_id", tokenId);
  url.searchParams.set("side", side);

  const response = await fetch(url, { signal });
  const body = (await response.json()) as Record<string, unknown>;

  if (response.ok) {
    const price = parsePrice(body.price);
    if (price !== null) {
      return { price, source: "clob" };
    }
  }

  const clobError =
    typeof body.error === "string"
      ? body.error
      : !response.ok
        ? `${response.status} ${response.statusText}`
        : "invalid price";

  const gammaFallback = await getGammaReferencePrice(tokenId, side);
  if (gammaFallback) {
    return {
      price: gammaFallback.price,
      source: "gamma",
      note: `${gammaFallback.note} CLOB: ${clobError}.`,
    };
  }

  throw new Error(
    `CLOB getMarketPrice failed (${clobError}) and no Gamma reference price was available for token ${tokenId}.`,
  );
}
