export type ResearchSourcePreview = {
  title: string;
  url: string;
  snippet?: string;
  score?: number;
};

export type ResearchSummaryPresentation = {
  marketId?: string;
  topic: string;
  sources: ResearchSourcePreview[];
};

export type RankedMarketPresentation = {
  rank: number;
  marketId: string;
  question: string;
  ev: number;
  confidence: number;
};

export function parseResearchMarkdown(
  raw: string,
  fallbackTopic?: string,
): ResearchSummaryPresentation {
  const topicMatch = raw.match(/^#\s*Web research:\s*(.+)$/m);
  const topic = (topicMatch?.[1] ?? fallbackTopic ?? "Market research").trim();

  const sources: ResearchSourcePreview[] = [];
  const blocks = raw.split(/\n(?=\d+\.\s)/);

  for (const block of blocks) {
    const titleMatch = block.match(/^\d+\.\s*(.+)$/m);
    if (!titleMatch?.[1]) {
      continue;
    }

    const urlMatch = block.match(/^\s*URL:\s*(\S+)/m);
    const scoreMatch = block.match(/^\s*Score:\s*([\d.]+)/m);
    const snippetMatch = block.match(/^\s*Snippet:\s*(.+)$/m);

    if (!urlMatch?.[1]) {
      continue;
    }

    sources.push({
      title: titleMatch[1].trim(),
      url: urlMatch[1].trim(),
      snippet: snippetMatch?.[1]?.trim(),
      score: scoreMatch?.[1] ? Number(scoreMatch[1]) : undefined,
    });
  }

  return { topic, sources };
}

export function formatResearchChatContent(presentation: ResearchSummaryPresentation): string {
  const headline = presentation.marketId
    ? `Research saved for market ${presentation.marketId}`
    : "Research saved";

  if (presentation.sources.length === 0) {
    return `${headline}\n${presentation.topic}`;
  }

  const sourceLines = presentation.sources
    .slice(0, 3)
    .map((source, index) => `${index + 1}. ${source.title}`)
    .join("\n");

  return `${headline}\n${presentation.topic}\n\nTop sources:\n${sourceLines}`;
}

export function buildRankedMarketPresentations(
  scoredMarkets: Array<{
    id: string;
    question: string;
    ev: number;
    confidence: number;
    edge?: number;
  }>,
): RankedMarketPresentation[] {
  const ordered = [...scoredMarkets].sort((left, right) => {
    if (left.ev !== right.ev) {
      return right.ev - left.ev;
    }
    return Math.abs(right.edge ?? 0) - Math.abs(left.edge ?? 0);
  });

  return ordered.map((market, index) => ({
    rank: index + 1,
    marketId: market.id,
    question: market.question,
    ev: market.ev,
    confidence: market.confidence,
  }));
}

export function formatDecideChatContent(markets: RankedMarketPresentation[]): string {
  if (markets.length === 0) {
    return "Scoring complete — pick one market for the detailed background pass.";
  }

  const preview = markets
    .slice(0, 3)
    .map(
      (market) =>
        `${market.rank}. ${market.question} (EV ${market.ev.toFixed(4)}, confidence ${(market.confidence * 100).toFixed(0)}%)`,
    )
    .join("\n");

  return `Scoring complete — pick one market for the detailed background pass.\n\nRanked snapshot:\n${preview}`;
}
