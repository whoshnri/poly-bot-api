import type {
  EssentialGammaMarket,
  GammaMarket,
  GetMarketByIdParams,
  GetMarketsParams,
  GetMarketsResponse,
  TradableMarketOutcome,
} from "../types/polymarket";

export const DEFAULT_GAMMA_API_URL = "https://gamma-api.polymarket.com";

type QueryValue = string | number | boolean | string[] | undefined;

function buildGammaUrl(
  path: string,
  query: Record<string, QueryValue>,
  gammaApiUrl: string
): string {
  const url = new URL(path, gammaApiUrl);

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

/**
 * Shared response handler for descriptive non-2xx errors.
 */
async function handleResponse<T>(
  response: Response,
  context: string
): Promise<T> {
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `${context} failed (${response.status} ${response.statusText}): ${errorText}`
    );
  }
  return response.json() as Promise<T>;
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function toStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as T;
}

function buildOutcomes(market: GammaMarket): TradableMarketOutcome[] {
  const rawNames = parseJsonArray(market.outcomes);
  const fallbackNames = parseJsonArray(market.shortOutcomes);
  const rawTokenIds = parseJsonArray(market.clobTokenIds);
  const rawPrices = parseJsonArray(market.outcomePrices);
  const maxLength = Math.max(rawNames.length, fallbackNames.length, rawTokenIds.length, rawPrices.length);

  return Array.from({ length: maxLength }, (_, index) => {
    const rawName = rawNames[index] ?? fallbackNames[index];
    const name = typeof rawName === "string" && rawName.trim().length > 0
      ? rawName
      : `Outcome ${index + 1}`;

    return compact({
      name,
      tokenId: toStringValue(rawTokenIds[index]),
      price: toNumber(rawPrices[index]),
    });
  });
}

export function toEssentialMarket(market: GammaMarket): EssentialGammaMarket {
  const negRiskMarketId = market.negRiskMarketID ?? market.negRiskMarketId;

  return compact({
    id: market.id,
    question: toStringValue(market.question),
    slug: toStringValue(market.slug),
    conditionId: toStringValue(market.conditionId),
    questionId: toStringValue(market.questionID),
    description: toStringValue(market.description),
    resolutionSource: toStringValue(market.resolutionSource),
    category: toStringValue(market.category),
    outcomes: buildOutcomes(market),
    active: toBoolean(market.active),
    closed: toBoolean(market.closed),
    archived: toBoolean(market.archived),
    acceptingOrders: toBoolean(market.acceptingOrders),
    enableOrderBook: toBoolean(market.enableOrderBook),
    restricted: toBoolean(market.restricted),
    startDate: toStringValue(market.startDateIso ?? market.startDate),
    endDate: toStringValue(market.endDateIso ?? market.endDate),
    gameStartTime: toStringValue(market.gameStartTime),
    secondsDelay: toNumber(market.secondsDelay),
    liquidity: toNumber(market.liquidityNum ?? market.liquidity),
    liquidityClob: toNumber(market.liquidityClob),
    volume: toNumber(market.volumeNum ?? market.volume),
    volume24hr: toNumber(market.volume24hr),
    volumeClob: toNumber(market.volumeClob),
    volume24hrClob: toNumber(market.volume24hrClob),
    bestBid: toNumber(market.bestBid),
    bestAsk: toNumber(market.bestAsk),
    orderMinSize: toNumber(market.orderMinSize),
    orderPriceMinTickSize: toNumber(market.orderPriceMinTickSize),
    makerBaseFee: toNumber(market.makerBaseFee),
    takerBaseFee: toNumber(market.takerBaseFee),
    umaResolutionStatus: toStringValue(market.umaResolutionStatus),
    negRisk: toBoolean(market.negRisk),
    negRiskMarketId: toStringValue(negRiskMarketId),
  });
}

export async function getMarkets({
  limit,
  afterCursor,
  order,
  ascending,
  closed,
  clobTokenIds,
  gammaApiUrl = DEFAULT_GAMMA_API_URL,
  signal,
}: GetMarketsParams): Promise<GetMarketsResponse> {
  if (limit !== undefined && (limit < 1 || limit > 1000)) {
    throw new Error("limit must be between 1 and 1000.");
  }

  const url = buildGammaUrl(
    "/markets/keyset",
    {
      limit,
      after_cursor: afterCursor,
      order,
      ascending,
      closed,
      clob_token_ids: clobTokenIds,
    },
    gammaApiUrl
  );

  const response = await fetch(url, { signal });
  const raw = await handleResponse<GetMarketsResponse<GammaMarket>>(response, "Gamma getMarkets");
  return {
    markets: raw.markets.map(toEssentialMarket),
    next_cursor: raw.next_cursor,
  };
}

export async function getMarketById({
  marketId,
  gammaApiUrl = DEFAULT_GAMMA_API_URL,
  signal,
}: GetMarketByIdParams): Promise<EssentialGammaMarket> {
  if (!marketId.trim()) {
    throw new Error("marketId is required.");
  }

  const url = new URL(`/markets/${encodeURIComponent(marketId)}`, gammaApiUrl);
  const response = await fetch(url, { signal });
  const raw = await handleResponse<GammaMarket>(response, "Gamma getMarketById");
  return toEssentialMarket(raw);
}

export async function getFilteredMarketById(
  marketId: string,
  gammaApiUrl: string = DEFAULT_GAMMA_API_URL
): Promise<EssentialGammaMarket> {
  const url = `${gammaApiUrl}/markets/${encodeURIComponent(marketId)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Market fetch failed: ${response.status} ${response.statusText}`
    );
  }

  const raw = (await response.json()) as GammaMarket;
  return toEssentialMarket(raw);
}
