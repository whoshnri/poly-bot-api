import { randomUUID } from "node:crypto";
import { publishSessionEvent } from "./events";
import type { PreSessionInput } from "./workflowLogic";

export type ExploreHandoffMessage = {
  role: "user" | "bot";
  content: string;
};

export function buildPreSessionHandoffMessage(
  selectedQuestion: string,
  topic?: string,
): string {
  const topicHint = topic?.trim() ? ` about **${topic.trim()}**` : "";
  return `You picked **${selectedQuestion}**${topicHint}. I'll run Tavily research, score the options, then ask you to approve any trade.`;
}

export function publishPreSessionHandoff(
  sessionId: string,
  preSession: PreSessionInput,
  exploreMessages?: ExploreHandoffMessage[],
): void {
  const timestamp = () => new Date().toISOString();
  const replay = (exploreMessages ?? preSession.exploreMessages ?? []).slice(-6);

  for (const message of replay) {
    const content = message.content?.trim();
    if (!content) {
      continue;
    }
    publishSessionEvent({
      id: randomUUID(),
      sessionId,
      timestamp: timestamp(),
      kind: "chat-message",
      payload: {
        role: message.role === "user" ? "user" : "bot",
        content,
      },
    });
  }

  const selected =
    preSession.markets.find((market) => market.marketId === preSession.selectedMarketId) ??
    preSession.markets[0];
  const handoff = buildPreSessionHandoffMessage(
    selected?.question ?? "your selected market",
    preSession.summary ?? preSession.topic,
  );

  publishSessionEvent({
    id: randomUUID(),
    sessionId,
    timestamp: timestamp(),
    kind: "chat-message",
    payload: { role: "bot", content: handoff },
  });
}
