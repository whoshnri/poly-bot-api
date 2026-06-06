import { randomUUID } from "node:crypto";
import type { BotUiEvent, BotUiEventKind, BotUiEventSink } from "../types/graph";
import { logEvent, logWarn } from "../shared/log";
import {
  readErrorMessage,
  shouldEmitRunErrorToUi,
} from "../shared/errorPresentation";

const MAX_SESSION_EVENTS = 500;

const CHAT_EVENT_KINDS = new Set<BotUiEventKind>([
  "chat-message",
  "feedback-request",
  "feedback-answer",
  "graph-run-start",
  "graph-run-complete",
  "graph-run-error",
  "ai-response",
  "stage-action",
  "bot-sleep",
]);

const sessionSubscribers = new Map<string, Set<BotUiEventSink>>();
const sessionEventHistory = new Map<string, BotUiEvent[]>();

export function isChatVisibleEvent(kind: BotUiEventKind): boolean {
  return CHAT_EVENT_KINDS.has(kind);
}

export function isDevOnlyEvent(kind: BotUiEventKind): boolean {
  return kind === "graph-node" || kind === "tool-call" || kind === "tool-result";
}

export function publishSessionEvent(event: BotUiEvent): void {
  const previousEvents = sessionEventHistory.get(event.sessionId) ?? [];
  const nextEvents =
    previousEvents.length >= MAX_SESSION_EVENTS
      ? [...previousEvents.slice(previousEvents.length - MAX_SESSION_EVENTS + 1), event]
      : [...previousEvents, event];
  sessionEventHistory.set(event.sessionId, nextEvents);

  const subscribers = sessionSubscribers.get(event.sessionId);
  const subscriberCount = subscribers?.size ?? 0;

  logEvent("session-events", event, {
    published: true,
    subscriberCount,
  });

  if (!subscribers) {
    return;
  }

  for (const subscriber of subscribers) {
    subscriber(event);
  }
}

export function getSessionEventsHistory(sessionId: string): BotUiEvent[] {
  return [...(sessionEventHistory.get(sessionId) ?? [])];
}

export function subscribeSessionEvents(sessionId: string, sink: BotUiEventSink): () => void {
  const existingSubscribers = sessionSubscribers.get(sessionId) ?? new Set<BotUiEventSink>();
  existingSubscribers.add(sink);
  sessionSubscribers.set(sessionId, existingSubscribers);

  return () => {
    const subscribers = sessionSubscribers.get(sessionId);
    if (!subscribers) {
      return;
    }

    subscribers.delete(sink);
    if (subscribers.size === 0) {
      sessionSubscribers.delete(sessionId);
    }
  };
}

export function replaySessionEvents(sessionId: string, sink: BotUiEventSink): number {
  const events = getSessionEventsHistory(sessionId);
  for (const event of events) {
    logEvent("session-events", event, {
      replay: true,
      published: false,
    });
    sink(event);
  }
  return events.length;
}

export function publishRunError(
  sessionId: string,
  error: unknown,
  context?: string,
): void {
  const errorMessage = readErrorMessage(error);
  const errorName = error instanceof Error ? error.name : "UnknownError";

  if (!shouldEmitRunErrorToUi(error)) {
    logWarn("run-error", "Suppressed non-user-facing run error", {
      sessionId,
      context,
      errorName,
      errorMessage,
    });
    return;
  }

  const timestamp = new Date().toISOString();
  const subtitle = context ? `${context} · run error` : "Run error";

  const graphError: BotUiEvent = {
    id: randomUUID(),
    sessionId,
    timestamp,
    kind: "graph-run-error",
    payload: {
      errorName,
      errorMessage,
      ...(context ? { context } : {}),
    },
  };

  const chatError: BotUiEvent = {
    id: randomUUID(),
    sessionId,
    timestamp,
    kind: "chat-message",
    payload: {
      role: "bot",
      content: `Something went wrong: ${errorMessage}`,
      subtitle,
      variant: "error",
    },
  };

  logEvent("run-error", graphError, { sessionId, published: true });
  publishSessionEvent(graphError);
  publishSessionEvent(chatError);
}

export function publishBotSleep(
  sessionId: string,
  reason: string,
  options?: { resumeable?: boolean; operatorDecision?: string },
): void {
  const timestamp = new Date().toISOString();
  const resumeable = options?.resumeable ?? true;

  publishSessionEvent({
    id: randomUUID(),
    sessionId,
    timestamp,
    kind: "bot-sleep",
    payload: {
      reason,
      resumeable,
      operatorDecision: options?.operatorDecision ?? "reject",
      phase: "SLEEP",
    },
  });

  publishSessionEvent({
    id: randomUUID(),
    sessionId,
    timestamp,
    kind: "chat-message",
    payload: {
      role: "bot",
      content: reason,
      subtitle: "Bot paused — no order placed",
      variant: "sleep",
    },
  });

  publishSessionEvent({
    id: randomUUID(),
    sessionId,
    timestamp,
    kind: "graph-run-complete",
    payload: {
      stopReason: reason,
      botSleep: true,
      stageActionComplete: true,
    },
  });
}
