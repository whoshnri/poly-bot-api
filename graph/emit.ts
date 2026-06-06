import { randomUUID } from "node:crypto";
import type { BotUiEvent, BotUiEventKind, TradingGraphNodeState } from "../types/graph";
import { logEvent, logWarn } from "../shared/log";

export function summarizeToolResultData(tool: string, data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === "string") {
    return data.length > 300 ? `${data.slice(0, 300)}…` : data;
  }

  if (Array.isArray(data)) {
    return { count: data.length };
  }

  if (typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (tool === "get-markets" && Array.isArray(record.markets)) {
      return {
        marketCount: record.markets.length,
        next_cursor: record.next_cursor,
      };
    }
    if (tool === "public-search" && Array.isArray(record.events)) {
      return {
        eventCount: record.events.length,
        titles: record.events
          .slice(0, 3)
          .map((event) =>
            event && typeof event === "object" && "title" in event
              ? (event as Record<string, unknown>).title
              : null,
          ),
      };
    }
    if (tool === "get-market-price" && "price" in record) {
      return record;
    }
    if (tool === "get-open-orders" && Array.isArray(data)) {
      return { orderCount: data.length };
    }
  }

  return data;
}

export function emitUiEvent(
  state: Pick<TradingGraphNodeState, "onEvent" | "sessionId" | "wakeTraceId" | "userId">,
  kind: BotUiEventKind,
  payload: Record<string, unknown>,
  sessionIdOverride?: string,
): void {
  const sessionId = sessionIdOverride ?? state.sessionId;
  const event: BotUiEvent = {
    id: randomUUID(),
    sessionId: sessionId ?? "unknown",
    timestamp: new Date().toISOString(),
    kind,
    payload: {
      wakeTraceId: state.wakeTraceId,
      ...payload,
    },
  };

  logEvent("graph.event", event, {
    sessionId,
    userId: state.userId,
    wakeTraceId: state.wakeTraceId,
    published: kind !== "graph-node" && kind !== "tool-call" && kind !== "tool-result",
  });

  const sink = state.onEvent;
  if (!sink || !sessionId) {
    if (!sessionId) {
      logWarn("graph.event", "Skipped publishing event without sessionId", {
        sessionId,
        userId: state.userId,
        wakeTraceId: state.wakeTraceId,
        kind,
      });
    }
    return;
  }

  if (kind === "graph-node" || kind === "tool-call" || kind === "tool-result") {
    return;
  }

  sink(event);
}

export function emitChatMessage(
  state: Pick<TradingGraphNodeState, "onEvent" | "sessionId" | "wakeTraceId" | "userId">,
  role: "user" | "bot",
  content: string,
  subtitle?: string,
  sessionIdOverride?: string,
  presentation?: {
    contentKind?: string;
    contentData?: Record<string, unknown>;
  },
): void {
  emitUiEvent(
    state,
    "chat-message",
    {
      role,
      content,
      ...(subtitle ? { subtitle } : {}),
      ...(presentation?.contentKind ? { contentKind: presentation.contentKind } : {}),
      ...(presentation?.contentData ? { contentData: presentation.contentData } : {}),
    },
    sessionIdOverride,
  );
}
