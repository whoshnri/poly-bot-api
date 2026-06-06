import type { BotUiEvent, BotUiEventKind } from "../types/graph";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type DebugLogContext = Record<string, unknown> & {
  sessionId?: string | null;
  userId?: string | null;
  wakeTraceId?: string | null;
};

type LogEntry = {
  at: string;
  level: LogLevel;
  scope: string;
  message: string;
  sessionId?: string | null;
  userId?: string | null;
  wakeTraceId?: string | null;
  eventKind?: BotUiEventKind;
  eventId?: string;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  details?: Record<string, unknown>;
};

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SECRET_VALUES = [
    process.env.TAVILY_API_KEY,
  process.env.ANTHROPIC_API_KEY,
  process.env.GEMINI_API_KEY,
  process.env.POLYMARKET_PRIVATE_KEY,
  process.env.POLY_API_KEY,
  process.env.SESSION_SECRET,
  process.env.WAKE_API_TOKEN,
].filter((value): value is string => typeof value === "string" && value.length > 0);

function resolveMinLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (
    configured === "debug" ||
    configured === "info" ||
    configured === "warn" ||
    configured === "error"
  ) {
    return configured;
  }

  if (process.env.DEBUG === "true" || process.env.NODE_ENV === "development") {
    return "debug";
  }

  return "info";
}

const MIN_LEVEL = resolveMinLevel();
const LOG_EVENTS = process.env.LOG_EVENTS !== "false";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[MIN_LEVEL];
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    let sanitized = value;
    for (const secret of SECRET_VALUES) {
      sanitized = sanitized.split(secret).join("[redacted]");
    }
    sanitized = sanitized
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
      .replace(/api[_-]?key["'\s:=]+[A-Za-z0-9._~+/=-]+/gi, "apiKey=[redacted]");

    if (sanitized.length > 1200) {
      return `${sanitized.slice(0, 1200)}… [truncated ${sanitized.length - 1200} chars]`;
    }

    return sanitized;
  }

  if (Array.isArray(value)) {
    if (value.length > 20) {
      return [...value.slice(0, 20).map(sanitizeValue), `… +${value.length - 20} more`];
    }
    return value.map(sanitizeValue);
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(record)) {
      sanitized[key] = sanitizeValue(entryValue);
    }
    return sanitized;
  }

  return value;
}

function compactDetails(context: DebugLogContext): Record<string, unknown> | undefined {
  const {
    sessionId: _sessionId,
    userId: _userId,
    wakeTraceId: _wakeTraceId,
    ...rest
  } = context;

  const entries = Object.entries(rest).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries.map(([key, value]) => [key, sanitizeValue(value)]));
}

function writeLog(entry: LogEntry): void {
  if (!shouldLog(entry.level)) {
    return;
  }

  const prefix = `[${entry.at}] ${entry.level.toUpperCase().padEnd(5)} ${entry.scope}`;
  const identity = [
    entry.sessionId ? `session=${entry.sessionId}` : null,
    entry.userId ? `user=${entry.userId}` : null,
    entry.wakeTraceId ? `wake=${entry.wakeTraceId}` : null,
    entry.eventKind ? `event=${entry.eventKind}` : null,
    entry.eventId ? `eventId=${entry.eventId}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const header = identity.length > 0 ? `${prefix} ${entry.message} | ${identity}` : `${prefix} ${entry.message}`;

  if (entry.error) {
    console.error(header);
    console.error(`  error: ${entry.error.name}: ${entry.error.message}`);
    if (entry.error.stack && MIN_LEVEL === "debug") {
      console.error(entry.error.stack);
    }
    if (entry.details) {
      console.error("  details:", entry.details);
    }
    return;
  }

  if (entry.level === "error" || entry.level === "warn") {
    console.warn(header);
    if (entry.details) {
      console.warn("  details:", entry.details);
    }
    return;
  }

  console.log(header);
  if (entry.details && (entry.level === "debug" || Object.keys(entry.details).length > 0)) {
    console.log("  details:", entry.details);
  }
}

function baseEntry(
  level: LogLevel,
  scope: string,
  message: string,
  context: DebugLogContext = {},
): LogEntry {
  return {
    at: new Date().toISOString(),
    level,
    scope,
    message,
    sessionId: context.sessionId ?? null,
    userId: context.userId ?? null,
    wakeTraceId: context.wakeTraceId ?? null,
    details: compactDetails(context),
  };
}

export function debugLog(scope: string, message: string, context: DebugLogContext = {}): void {
  writeLog(baseEntry("debug", scope, message, context));
}

export function logInfo(scope: string, message: string, context: DebugLogContext = {}): void {
  writeLog(baseEntry("info", scope, message, context));
}

export function logWarn(scope: string, message: string, context: DebugLogContext = {}): void {
  writeLog(baseEntry("warn", scope, message, context));
}

export function debugError(
  scope: string,
  message: string,
  context: DebugLogContext = {},
  error?: unknown,
): void {
  const entry = baseEntry("error", scope, message, context);

  if (error instanceof Error) {
    entry.error = {
      name: error.name,
      message: sanitizeValue(error.message) as string,
      stack: error.stack,
    };
  } else if (error !== undefined) {
    entry.error = {
      name: "Error",
      message: sanitizeValue(String(error)) as string,
    };
  } else if (typeof context.error === "string") {
    entry.error = {
      name: "Error",
      message: context.error,
    };
  }

  writeLog(entry);
}

function summarizeEventPayload(kind: BotUiEventKind, payload: Record<string, unknown>): Record<string, unknown> {
  switch (kind) {
    case "chat-message":
      return {
        role: payload.role,
        content: payload.content,
        subtitle: payload.subtitle,
        variant: payload.variant,
      };
    case "tool-call":
      return {
        tool: payload.tool,
        reason: payload.reason,
        metadata: payload.metadata,
      };
    case "tool-result":
      return {
        tool: payload.tool,
        status: payload.status,
        message: payload.message,
        error: payload.error,
      };
    case "ai-response":
      return {
        stageAction: payload.stageAction,
        toolCallCount: payload.toolCallCount,
        message:
          payload.response && typeof payload.response === "object"
            ? (payload.response as Record<string, unknown>).message
            : undefined,
      };
    case "stage-action":
      return {
        stageAction: payload.stageAction,
        status: payload.status,
        reason: payload.reason,
        errorMessage: payload.errorMessage,
      };
    case "feedback-request":
      return {
        requestId: payload.requestId,
        type: payload.type,
        question: payload.question,
      };
    case "feedback-answer":
      return {
        requestId: payload.requestId,
        formattedAnswer: payload.formattedAnswer,
      };
    case "graph-run-start":
      return {
        forceInitPath: payload.forceInitPath,
      };
    case "graph-run-complete":
      return {
        stopReason: payload.stopReason,
        stageActionComplete: payload.stageActionComplete,
        awaitingFeedback: payload.awaitingFeedback,
        failed: payload.failed,
        circuitBreakerTripped: payload.circuitBreakerTripped,
      };
    case "graph-run-error":
      return {
        errorName: payload.errorName,
        errorMessage: payload.errorMessage,
        context: payload.context,
      };
    case "graph-node":
      return {
        node: payload.node,
        ...payload,
      };
    default:
      return payload;
  }
}

export function logEvent(
  scope: string,
  event: BotUiEvent,
  context: DebugLogContext & {
    published?: boolean;
    subscriberCount?: number;
    replay?: boolean;
  } = {},
): void {
  if (!LOG_EVENTS || !shouldLog("info")) {
    return;
  }

  writeLog({
    at: event.timestamp,
    level: event.kind === "graph-run-error" ? "error" : "info",
    scope,
    message: context.replay ? "Replay session event" : "Session event published",
    sessionId: event.sessionId,
    userId: context.userId ?? null,
    wakeTraceId:
      typeof event.payload.wakeTraceId === "string" ? event.payload.wakeTraceId : context.wakeTraceId ?? null,
    eventKind: event.kind,
    eventId: event.id,
    details: sanitizeValue({
      published: context.published,
      subscriberCount: context.subscriberCount,
      replay: context.replay,
      payload: summarizeEventPayload(event.kind, event.payload),
    }) as Record<string, unknown>,
  });
}

export function logGraphTransition(
  from: string,
  to: string,
  context: DebugLogContext = {},
): void {
  logInfo("graph.route", `${from} -> ${to}`, context);
}

export function getLogConfig(): { minLevel: LogLevel; logEvents: boolean } {
  return {
    minLevel: MIN_LEVEL,
    logEvents: LOG_EVENTS,
  };
}
