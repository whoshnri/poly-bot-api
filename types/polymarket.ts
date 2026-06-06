import type {
  Chain,
  ClobClient,
  ClobSigner,
  CreateOrderOptions,
  HeartbeatResponse,
  UserMarketOrder,
  UserOrder,
} from "@polymarket/clob-client";
import type { OrderType } from "@polymarket/clob-client";

export type TwoLevelAuthConfig = {
  host?: string;
  chainId?: Chain;
  signer: ClobSigner;
  signatureType?: 0 | 1 | 2;
  funderAddress: string;
};

export type AssertPolymarketClientReadyParams = {
  client: ClobClient;
};

export type CreateOrderParams = {
  client: ClobClient;
  order: UserOrder;
  options?: Partial<CreateOrderOptions>;
  orderType?: OrderType.GTC | OrderType.GTD;
  deferExecution?: boolean;
  postOnly?: boolean;
};

export type CreateMarketOrderParams = {
  client: ClobClient;
  order: UserMarketOrder;
  options?: Partial<CreateOrderOptions>;
  orderType?: OrderType.FOK | OrderType.FAK;
  deferExecution?: boolean;
};

export type MarketPriceResponse = {
  price: number;
  source: "clob" | "gamma";
  note?: string;
};

export type MarketSide = "BUY" | "SELL";

export type GetMarketPriceParams = {
  tokenId: string;
  side: MarketSide;
  clobApiUrl?: string;
  signal?: AbortSignal;
};

export type GammaRequestOptions = {
  gammaApiUrl?: string;
  signal?: AbortSignal;
};

export type GammaMarket = {
  id: string;
  question?: string;
  conditionId?: string;
  questionID?: string;
  description?: string;
  resolutionSource?: string;
  category?: string;
  slug?: string;
  clobTokenIds?: string;
  outcomes?: string;
  shortOutcomes?: string;
  outcomePrices?: string;
  bestBid?: number | string;
  bestAsk?: number | string;
  [key: string]: unknown;
};

export type TradableMarketOutcome = {
  name: string;
  tokenId?: string;
  price?: number;
};

export type EssentialGammaMarket = {
  id: string;
  question?: string;
  slug?: string;
  conditionId?: string;
  questionId?: string;
  description?: string;
  resolutionSource?: string;
  category?: string;
  outcomes: TradableMarketOutcome[];
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  acceptingOrders?: boolean;
  enableOrderBook?: boolean;
  restricted?: boolean;
  startDate?: string;
  endDate?: string;
  gameStartTime?: string;
  secondsDelay?: number;
  liquidity?: number;
  liquidityClob?: number;
  volume?: number;
  volume24hr?: number;
  volumeClob?: number;
  volume24hrClob?: number;
  bestBid?: number;
  bestAsk?: number;
  orderMinSize?: number;
  orderPriceMinTickSize?: number;
  makerBaseFee?: number;
  takerBaseFee?: number;
  umaResolutionStatus?: string;
  negRisk?: boolean;
  negRiskMarketId?: string;
};

export type GetMarketsResponse<TMarket = EssentialGammaMarket> = {
  markets: TMarket[];
  next_cursor?: string;
};

export type GetMarketsParams = GammaRequestOptions & {
  limit?: number;
  afterCursor?: string;
  order?: string;
  ascending?: boolean;
  closed?: boolean;
  clobTokenIds?: string[];
};

export type GetMarketByIdParams = GammaRequestOptions & {
  marketId: string;
};

export type PublicSearchEvent = {
  id: string;
  title?: string;
  slug?: string;
  description?: string;
  active?: boolean;
  closed?: boolean;
  volume?: number;
  liquidity?: number;
  markets: EssentialGammaMarket[];
};

export type PublicSearchTag = {
  id: string;
  label: string;
  slug: string;
  event_count: number;
};

export type PublicSearchPagination = {
  hasMore: boolean;
  totalResults: number;
};

export type PublicSearchResponse = {
  events: PublicSearchEvent[];
  tags?: PublicSearchTag[];
  pagination?: PublicSearchPagination;
};

export type PublicSearchParams = GammaRequestOptions & {
  q: string;
  limitPerType?: number;
  page?: number;
  eventsStatus?: string;
  eventsTag?: string[];
  keepClosedMarkets?: number;
  sort?: string;
  ascending?: boolean;
  searchTags?: boolean;
  searchProfiles?: boolean;
  cache?: boolean;
};

export type SendHeartbeatParams = {
  client: ClobClient;
  heartbeatId?: string | null;
};

export type RunHeartbeatLoopParams = {
  client: ClobClient;
  intervalMs?: number;
  initialHeartbeatId?: string | null;
  signal?: AbortSignal;
  onHeartbeat?: (response: HeartbeatResponse) => void;
};
