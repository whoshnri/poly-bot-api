import { saveTargetToken, updateTargetToken } from "../session/targets";
import { runWebResearch } from "../research/tavily";
import {
  cancelUnwantedOrder,
  getMarketById,
  getMarketPrice,
  getMarkets,
  getOpenOrders,
  publicSearch,
} from "../polymarket";
import type {
  ToolConfigMap,
  ToolExecutorConfig,
  ToolResponse,
  ToolResultMap,
  ToolSlug,
} from "../types/tools";

function toToolResponse<TData>(message: string, data: TData): ToolResponse<TData> {
  return {
    status: "success",
    message,
    data,
  };
}

function sanitizeToolErrorDetails(details: string): string {
  let sanitized = details;
  const secretValues = [
    process.env.TAVILY_API_KEY,
    process.env.ANTHROPIC_API_KEY,
    process.env.GEMINI_API_KEY,
    process.env.POLYMARKET_PRIVATE_KEY,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const secret of secretValues) {
    sanitized = sanitized.split(secret).join("[redacted]");
  }

  return sanitized
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key["'\s:=]+[A-Za-z0-9._~+/=-]+/gi, "apiKey=[redacted]");
}

function toToolErrorResponse(error: unknown): ToolResponse<never> {
  if (error instanceof Error) {
    return {
      status: "error",
      message: "Tool execution failed.",
      data: null,
      error: {
        name: error.name,
        details: sanitizeToolErrorDetails(error.message),
      },
    };
  }

  return {
    status: "error",
    message: "Tool execution failed with a non-Error throw value.",
    data: null,
    error: {
      name: "UnknownError",
      details: sanitizeToolErrorDetails(String(error)),
    },
  };
}

export async function executeTool(
  toolSlug: ToolSlug,
  config: ToolExecutorConfig,
): Promise<ToolResultMap[ToolSlug]> {
  try {
    switch (toolSlug) {
      case "get-markets": {
        const result = await getMarkets(config as ToolConfigMap["get-markets"]);
        return toToolResponse(
          `Fetched ${result.markets.length} market(s).`,
          result,
        ) as ToolResultMap[ToolSlug];
      }
      case "get-market-by-id": {
        const result = await getMarketById(config as ToolConfigMap["get-market-by-id"]);
        return toToolResponse(`Fetched market ${result.id}.`, result) as ToolResultMap[ToolSlug];
      }
      case "get-market-price": {
        const result = await getMarketPrice(config as ToolConfigMap["get-market-price"]);
        const sourceNote = result.source === "gamma" ? ` (${result.note ?? "gamma fallback"})` : "";
        return toToolResponse(`Fetched market price: ${result.price}${sourceNote}.`, result) as ToolResultMap[ToolSlug];
      }
      case "public-search": {
        const result = await publicSearch(config as ToolConfigMap["public-search"]);
        return toToolResponse(
          `Found ${result.events.length} event(s) for "${(config as ToolConfigMap["public-search"]).q}".`,
          result,
        ) as ToolResultMap[ToolSlug];
      }
      case "get-open-orders": {
        const result = await getOpenOrders(config as ToolConfigMap["get-open-orders"]);
        return toToolResponse(`Fetched ${result.length} open order(s).`, result) as ToolResultMap[ToolSlug];
      }
      case "save-target-token": {
        const result = await saveTargetToken(config as ToolConfigMap["save-target-token"]);
        return toToolResponse("Target token saved.", result) as ToolResultMap[ToolSlug];
      }
      case "update-target-token": {
        const result = await updateTargetToken(config as ToolConfigMap["update-target-token"]);
        return toToolResponse("Target token updated.", result) as ToolResultMap[ToolSlug];
      }
      case "cancel-unwanted-order": {
        const result = await cancelUnwantedOrder(
          (config as ToolConfigMap["cancel-unwanted-order"]).orderId,
        );
        return toToolResponse(`Cancelled order ${result.orderId}.`, result) as ToolResultMap[ToolSlug];
      }
      case "web_research": {
        const result = await runWebResearch(config as ToolConfigMap["web_research"]);
        return toToolResponse("Web research completed.", result) as ToolResultMap[ToolSlug];
      }
      case "request_feedback": {
        throw new Error("request_feedback is handled by the graph orchestrator, not executeTool.");
      }
      default: {
        const unsupportedTool = toolSlug satisfies never;
        throw new Error(`Unsupported tool slug: ${unsupportedTool}`);
      }
    }
  } catch (error) {
    return toToolErrorResponse(error) as ToolResultMap[ToolSlug];
  }
}
