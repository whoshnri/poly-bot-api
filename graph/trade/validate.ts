import { botConfig } from "../../config/bot";
import { getMarkets } from "../../polymarket";
import type { AiModelResponse } from "../../types/schemas";
import type { EssentialGammaMarket } from "../../types/polymarket";
import type { OpenOrderRecord } from "../../types/tools";

export type StageActionData = NonNullable<AiModelResponse["nextStage"]["stageActionData"]>;

export type StartTradeOrder = {
  tokenId: string;
  side: "BUY" | "SELL";
  price: number;
  shareSize: number;
  orderType: "GTC" | "GTD";
  postOnly?: boolean;
  expiration?: number;
};

export type StartTradeActionData = {
  reason: string;
  resumeAt: string;
  order: StartTradeOrder;
};

export type EndTradeActionData = { reason: string };
export type WaitActionData = { reason: string; resumeAt: string };
export type SkipActionData = { reason: string };
export type ClarifyActionData = { reason: string; userMessageHtml: string; resumeAt: string };

export function asStartTradeActionData(
  data: StageActionData | null,
): StartTradeActionData {
  if (
    data === null ||
    typeof data !== "object" ||
    !("order" in data) ||
    !("resumeAt" in data) ||
    !("reason" in data)
  ) {
    throw new Error("START_TRADE requires valid stageActionData.");
  }

  return data as StartTradeActionData;
}

export function asEndTradeActionData(
  data: StageActionData | null,
): EndTradeActionData {
  if (data === null || typeof data !== "object" || !("reason" in data)) {
    throw new Error("END_TRADE requires valid stageActionData.");
  }

  return data as EndTradeActionData;
}

export function asWaitActionData(data: StageActionData | null): WaitActionData {
  if (
    data === null ||
    typeof data !== "object" ||
    !("reason" in data) ||
    !("resumeAt" in data)
  ) {
    throw new Error("WAIT requires valid stageActionData.");
  }

  return data as WaitActionData;
}

export function asSkipActionData(data: StageActionData | null): SkipActionData {
  if (data === null || typeof data !== "object" || !("reason" in data)) {
    throw new Error("SKIP requires valid stageActionData.");
  }

  return data as SkipActionData;
}

export function asClarifyActionData(data: StageActionData | null): ClarifyActionData {
  if (
    data === null ||
    typeof data !== "object" ||
    !("reason" in data) ||
    !("userMessageHtml" in data) ||
    !("resumeAt" in data)
  ) {
    throw new Error("CLARIFY requires valid stageActionData.");
  }

  return data as ClarifyActionData;
}

export function getRequiredSessionId(sessionId: string | null): string {
  if (!sessionId) {
    throw new Error("Stage action execution requires a sessionId.");
  }

  return sessionId;
}

export function extractOrderId(orderResult: unknown): string {
  if (!orderResult || typeof orderResult !== "object") {
    throw new Error("Order execution did not return a valid payload.");
  }

  const result = orderResult as Record<string, unknown>;
  const candidate = result.orderID ?? result.orderId ?? result.id;

  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error(
      "Unable to extract order id from order execution response.",
    );
  }

  return candidate;
}

export function validateStartTradeOrder(order: StartTradeOrder): StartTradeOrder {
  if (!order.tokenId.trim()) {
    throw new Error("START_TRADE order.tokenId must be non-empty.");
  }
  if (order.side !== "BUY" && order.side !== "SELL") {
    throw new Error("START_TRADE order.side must be BUY or SELL.");
  }
  if (!Number.isFinite(order.price) || order.price <= 0) {
    throw new Error(
      "START_TRADE order.price must be a positive finite number.",
    );
  }
  if (!Number.isFinite(order.shareSize) || order.shareSize <= 0) {
    throw new Error(
      "START_TRADE order.shareSize must be a positive finite number.",
    );
  }
  if (order.orderType !== "GTC" && order.orderType !== "GTD") {
    throw new Error("START_TRADE order.orderType must be GTC or GTD.");
  }
  const expiration = order.expiration;
  if (
    order.orderType === "GTD" &&
    (!Number.isInteger(expiration) || (expiration ?? 0) <= 0)
  ) {
    throw new Error("START_TRADE order.expiration is required for GTD orders.");
  }
  if (order.orderType === "GTC" && order.expiration !== undefined) {
    throw new Error(
      "START_TRADE order.expiration is only valid for GTD orders.",
    );
  }

  const g = botConfig.tradeGuardrails;
  const orderNotional = estimateOrderNotional(order);

  if (!g.allowedSides.includes(order.side)) {
    throw new Error(
      `START_TRADE order.side "${order.side}" is not in allowedSides: ${g.allowedSides.join(", ")}.`,
    );
  }
  if (orderNotional > g.maxOrderSizeUsdc) {
    throw new Error(
      `START_TRADE order notional ${orderNotional} exceeds maxOrderSizeUsdc ${g.maxOrderSizeUsdc}.`,
    );
  }
  if (order.price < g.minPrice || order.price > g.maxPrice) {
    throw new Error(
      `START_TRADE order.price ${order.price} is outside allowed range [${g.minPrice}, ${g.maxPrice}].`,
    );
  }

  return order;
}

export function estimateOrderNotional(order: StartTradeOrder): number {
  return order.price * order.shareSize;
}

export function parseOpenOrderNumber(value: string | undefined): number {
  if (value === undefined) {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function estimateOpenOrderExposure(order: OpenOrderRecord): number {
  const originalSize = parseOpenOrderNumber(order.original_size);
  const matchedSize = parseOpenOrderNumber(order.size_matched);
  const remainingSize = Math.max(originalSize - matchedSize, 0);
  const price = parseOpenOrderNumber(order.price);
  return remainingSize * price;
}

export function validateExposure(
  order: StartTradeOrder,
  openOrders: OpenOrderRecord[],
): void {
  const existingExposure = openOrders.reduce(
    (total, openOrder) => total + estimateOpenOrderExposure(openOrder),
    0,
  );
  const nextExposure = existingExposure + estimateOrderNotional(order);
  const maxExposure = botConfig.tradeGuardrails.maxExposureUsdc;

  if (nextExposure > maxExposure) {
    throw new Error(
      `START_TRADE total estimated exposure ${nextExposure} exceeds maxExposureUsdc ${maxExposure}.`,
    );
  }
}

export function priceFitsTick(price: number, tickSize: number): boolean {
  if (!Number.isFinite(tickSize) || tickSize <= 0) {
    return true;
  }

  const quotient = price / tickSize;
  return Math.abs(quotient - Math.round(quotient)) < 1e-9;
}

export async function getMarketForOrder(
  order: StartTradeOrder,
): Promise<EssentialGammaMarket> {
  const result = await getMarkets({
    limit: 1,
    closed: false,
    clobTokenIds: [order.tokenId],
  });
  const [market] = result.markets;

  if (!market) {
    throw new Error(`No active Gamma market found for token ${order.tokenId}.`);
  }

  const tokenExists = market.outcomes.some(
    (outcome) => outcome.tokenId === order.tokenId,
  );
  if (!tokenExists) {
    throw new Error(
      `Market ${market.id} does not include token ${order.tokenId}.`,
    );
  }

  return market;
}

export function validateMarketConstraints(
  order: StartTradeOrder,
  market: EssentialGammaMarket,
): void {
  if (
    market.active === false ||
    market.closed === true ||
    market.archived === true
  ) {
    throw new Error(`Market ${market.id} is not active for trading.`);
  }
  if (market.acceptingOrders === false) {
    throw new Error(`Market ${market.id} is not accepting orders.`);
  }
  if (market.enableOrderBook === false) {
    throw new Error(`Market ${market.id} does not have an enabled order book.`);
  }
  if (market.restricted === true) {
    throw new Error(`Market ${market.id} is restricted.`);
  }
  if (
    market.orderMinSize !== undefined &&
    order.shareSize < market.orderMinSize
  ) {
    throw new Error(
      `START_TRADE shareSize ${order.shareSize} is below market orderMinSize ${market.orderMinSize}.`,
    );
  }
  if (
    market.orderPriceMinTickSize !== undefined &&
    !priceFitsTick(order.price, market.orderPriceMinTickSize)
  ) {
    throw new Error(
      `START_TRADE price ${order.price} does not fit market tick size ${market.orderPriceMinTickSize}.`,
    );
  }
}

export function orderLooksEquivalent(
  intended: StartTradeOrder,
  openOrder: OpenOrderRecord,
): boolean {
  if (openOrder.asset_id !== intended.tokenId) {
    return false;
  }

  if (typeof openOrder.side === "string" && openOrder.side !== intended.side) {
    return false;
  }

  if (typeof openOrder.price === "string") {
    const parsedPrice = Number(openOrder.price);
    if (
      Number.isFinite(parsedPrice) &&
      Math.abs(parsedPrice - intended.price) > 1e-9
    ) {
      return false;
    }
  }

  if (typeof openOrder.original_size === "string") {
    const parsedSize = Number(openOrder.original_size);
    if (
      Number.isFinite(parsedSize) &&
      Math.abs(parsedSize - intended.shareSize) > 1e-9
    ) {
      return false;
    }
  }

  return true;
}
