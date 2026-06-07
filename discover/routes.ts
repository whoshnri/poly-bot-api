import type { Context } from "hono";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createChatModel } from "../graph/model/providers";
import { getUserAiConfig } from "../graph/model/getUserConfig";
import { publicSearch } from "../polymarket/publicSearch";
import { jsonFail, jsonOk } from "../shared/apiResponse";
import { assertUserCanRunBot } from "../db/users";
import { OPERATOR_VOICE_GUIDELINES } from "../shared/operatorVoice";
import { scoreDiscoverMarkets, type DiscoverMarketHit } from "./scoring";

export type DiscoverChatMessage = {
  role: "user" | "bot";
  content: string;
};

type DiscoverChatResult = {
  reply: string;
  topic?: string;
  queries?: string[];
  readyToSearch: boolean;
};

const DISCOVER_SYSTEM = [
  "You help operators find Polymarket markets before a trading session starts.",
  OPERATOR_VOICE_GUIDELINES,
  "Return ONLY valid JSON with this shape:",
  '{ "reply": string, "topic"?: string, "queries"?: string[3], "readyToSearch": boolean }',
  "Ask one clarifying question at a time when the topic is vague.",
  "When you have enough context, set readyToSearch=true and provide exactly 3 diverse search queries.",
  "Queries should be short keyword phrases suitable for Polymarket search (not full sentences).",
].join("\n");

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseDiscoverChatResult(raw: string, fallbackTopic: string): DiscoverChatResult {
  const parsed = extractJsonObject(raw);
  if (!parsed) {
    return {
      reply: raw.trim() || "Tell me what kind of markets you want to explore.",
      readyToSearch: false,
    };
  }

  const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
  const topic = typeof parsed.topic === "string" ? parsed.topic.trim() : fallbackTopic;
  const queries = Array.isArray(parsed.queries)
    ? parsed.queries
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 3)
    : undefined;
  const readyToSearch = parsed.readyToSearch === true;

  return {
    reply: reply || "What topic or event should we explore on Polymarket?",
    topic: topic || undefined,
    queries,
    readyToSearch,
  };
}

export async function discoverChat(c: Context) {
  const userId = c.get("userId");
  const body = (await c.req.json()) as { messages?: DiscoverChatMessage[] };
  const messages = body.messages ?? [];

  if (messages.length === 0) {
    return jsonFail(c, "At least one message is required.", 400);
  }

  try {
    await assertUserCanRunBot(userId);
  } catch (error) {
    return jsonFail(
      c,
      error instanceof Error ? error.message : "Account is not ready to run the bot.",
      412,
    );
  }

  const aiConfig = await getUserAiConfig(userId);
  if (!aiConfig) {
    return jsonFail(c, "Configure an AI provider in settings first.", 412);
  }

  const conversation = messages
    .slice(-12)
    .map((entry) => `${entry.role === "user" ? "Operator" : "Assistant"}: ${entry.content}`)
    .join("\n");

  const model = createChatModel(aiConfig);
  const response = await model.invoke([
    new SystemMessage(DISCOVER_SYSTEM),
    new HumanMessage(conversation),
  ]);

  const raw =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content ?? "");
  const lastUser = [...messages].reverse().find((entry) => entry.role === "user");
  const result = parseDiscoverChatResult(raw, lastUser?.content?.trim() ?? "");

  return jsonOk(c, result);
}

export async function discoverRun(c: Context) {
  const userId = c.get("userId");
  const body = (await c.req.json()) as {
    topic?: string;
    queries?: string[];
    limit?: number;
  };

  const topic = body.topic?.trim() ?? "";
  const queries = (body.queries ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 3);
  const limit = Math.min(Math.max(body.limit ?? 10, 1), 20);

  if (topic.length === 0 && queries.length === 0) {
    return jsonFail(c, "Provide a topic or at least one search query.", 400);
  }

  try {
    await assertUserCanRunBot(userId);
  } catch (error) {
    return jsonFail(
      c,
      error instanceof Error ? error.message : "Account is not ready to run the bot.",
      412,
    );
  }

  const searchQueries =
    queries.length > 0 ? queries : [topic, `${topic} prediction`, `${topic} odds`].slice(0, 3);

  const hits: DiscoverMarketHit[] = [];
  for (const query of searchQueries) {
    const result = await publicSearch({
      q: query,
      limitPerType: 8,
      eventsStatus: "active",
      keepClosedMarkets: 0,
      sort: "volume",
      ascending: false,
    });

    for (const event of result.events ?? []) {
      for (const market of event.markets ?? []) {
        if (market.closed || market.active === false) {
          continue;
        }
        hits.push({
          marketId: market.id,
          question: market.question ?? "Untitled market",
          eventTitle: event.title,
          volume: market.volume ?? market.volume24hr ?? event.volume,
          liquidity: market.liquidity ?? market.liquidityClob ?? event.liquidity,
          query,
          active: market.active !== false,
        });
      }
    }
  }

  const markets = scoreDiscoverMarkets(hits, topic, limit);

  return jsonOk(c, {
    topic,
    queries: searchQueries,
    markets,
  });
}
