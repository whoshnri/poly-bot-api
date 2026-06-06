import type { AiGraphMessage } from "../types/graph";

export function formatConversation(messages: AiGraphMessage[]): string {
  return messages
    .map((message) => `[${message.role.toUpperCase()}] ${message.content}`)
    .join("\n\n");
}

export function createServerMessage(content: string): AiGraphMessage {
  return {
    role: "server",
    content,
    timestamp: new Date().toISOString(),
  };
}

export function createAiMessage(content: string): AiGraphMessage {
  return {
    role: "ai",
    content,
    timestamp: new Date().toISOString(),
  };
}
