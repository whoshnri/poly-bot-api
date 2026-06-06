import type {
  EssentialGammaMarket,
  GetMarketByIdParams,
  GetMarketPriceParams,
  GetMarketsParams,
  GetMarketsResponse,
  MarketPriceResponse,
  PublicSearchParams,
  PublicSearchResponse,
} from "./polymarket";
import type { WebResearchConfig } from "./research";

export type TargetTokenPayload = {
  tokenId: string;
  marketId?: string;
  note?: string;
  savedAt: string;
};

export type SaveTargetTokenParams = {
  sessionId: string;
  tokenId: string;
  marketId?: string;
  note?: string;
};

export type UpdateTargetTokenParams = {
  sessionId: string;
  tokenId: string;
  marketId?: string;
  note?: string;
};

export type GetOpenOrdersParams = {
  tokenId?: string;
  marketId?: string;
};

export type OpenOrderRecord = {
  id: string;
  asset_id?: string;
  market?: string;
  side?: string;
  price?: string;
  original_size?: string;
  size_matched?: string;
  status?: string;
};

export type CancelUnwantedOrderParams = {
  orderId: string;
};

export type CancelUnwantedOrderResult = {
  orderId: string;
  cancelled: unknown;
};

export type RequestFeedbackConfig = {
  type: "mcq" | "text" | "mcq_or_custom" | "multi_select";
  question: string;
  options?: string[];
  minSelections?: number;
  maxSelections?: number;
};

export type RequestFeedbackResult = {
  requestId: string;
  status: "pending";
  question: string;
  type: RequestFeedbackConfig["type"];
};

export type ToolSlug =
  | "get-markets"
  | "get-market-by-id"
  | "get-market-price"
  | "get-open-orders"
  | "save-target-token"
  | "update-target-token"
  | "cancel-unwanted-order"
  | "public-search"
  | "web_research"
  | "request_feedback";

export type ToolConfigMap = {
  "get-markets": GetMarketsParams;
  "get-market-by-id": GetMarketByIdParams;
  "get-market-price": GetMarketPriceParams;
  "get-open-orders": GetOpenOrdersParams;
  "save-target-token": SaveTargetTokenParams;
  "update-target-token": UpdateTargetTokenParams;
  "cancel-unwanted-order": CancelUnwantedOrderParams;
  "public-search": PublicSearchParams;
  web_research: WebResearchConfig;
  request_feedback: RequestFeedbackConfig;
};

export type ToolSuccessResponse<TData> = {
  status: "success";
  message: string;
  data: TData;
};

export type ToolErrorResponse = {
  status: "error";
  message: string;
  data: null;
  error: {
    name: string;
    details?: string;
  };
};

export type ToolResponse<TData> = ToolSuccessResponse<TData> | ToolErrorResponse;

export type ToolResultMap = {
  "get-markets": ToolResponse<GetMarketsResponse<EssentialGammaMarket>>;
  "get-market-by-id": ToolResponse<EssentialGammaMarket>;
  "get-market-price": ToolResponse<MarketPriceResponse>;
  "get-open-orders": ToolResponse<OpenOrderRecord[]>;
  "save-target-token": ToolResponse<TargetTokenPayload>;
  "update-target-token": ToolResponse<TargetTokenPayload>;
  "cancel-unwanted-order": ToolResponse<CancelUnwantedOrderResult>;
  "public-search": ToolResponse<PublicSearchResponse>;
  web_research: ToolResponse<string>;
  request_feedback: ToolResponse<RequestFeedbackResult>;
};

export type ToolExecutorConfig = ToolConfigMap[ToolSlug];
