export type ResearchEntry = {
  marketId: string;
  topic: string;
  intent: string;
  mcpTool: string;
  summary: string;
  searchedAt: string;
};

export type ResearchCookie = Record<string, ResearchEntry[]>;

export function readResearchCookie(metadata: unknown): ResearchCookie {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }

  const raw = (metadata as Record<string, unknown>).researchCookie;
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const cookie: ResearchCookie = {};
  for (const [marketId, entries] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(entries)) {
      continue;
    }

    const parsed = entries
      .map((entry) => readResearchEntry(entry))
      .filter((entry): entry is ResearchEntry => entry !== null);

    if (parsed.length > 0) {
      cookie[marketId] = parsed;
    }
  }

  return cookie;
}

export function upsertResearchEntry(
  cookie: ResearchCookie,
  entry: ResearchEntry,
): ResearchCookie {
  const existing = cookie[entry.marketId] ?? [];
  return {
    ...cookie,
    [entry.marketId]: [...existing, entry],
  };
}

export function listResearchedMarketIds(cookie: ResearchCookie): string[] {
  return Object.keys(cookie).filter((marketId) => (cookie[marketId]?.length ?? 0) > 0);
}

export function summarizeResearchCookie(cookie: ResearchCookie): string {
  const marketIds = listResearchedMarketIds(cookie);
  if (marketIds.length === 0) {
    return "No research accumulated yet.";
  }

  const lines: string[] = [];
  for (const marketId of marketIds) {
    const entries = cookie[marketId] ?? [];
    const latest = entries.at(-1);
    if (!latest) {
      continue;
    }

    lines.push(
      `- ${marketId}: ${entries.length} research pass(es). Latest intent: ${latest.intent}`,
    );
  }

  return lines.join("\n");
}

function readResearchEntry(value: unknown): ResearchEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.marketId !== "string" ||
    typeof record.topic !== "string" ||
    typeof record.intent !== "string" ||
    typeof record.mcpTool !== "string" ||
    typeof record.summary !== "string" ||
    typeof record.searchedAt !== "string"
  ) {
    return null;
  }

  return {
    marketId: record.marketId,
    topic: record.topic,
    intent: record.intent,
    mcpTool: record.mcpTool,
    summary: record.summary,
    searchedAt: record.searchedAt,
  };
}
