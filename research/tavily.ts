import { tavily } from "@tavily/core";
import type { WebResearchConfig, WebResearchDepth } from "../types/research";

type TavilySearchHit = {
  url: string;
  title?: string;
  content?: string;
  score?: number;
};

type TavilySearchResponse = {
  query?: string;
  results?: TavilySearchHit[];
  response_time?: number;
};

type TavilyCrawlPage = {
  url: string;
  raw_content?: string;
};

type TavilyCrawlResponse = {
  base_url?: string;
  results?: TavilyCrawlPage[];
};

const QUICK_RESEARCH_TIMEOUT_MS = 45_000;
const DEEP_RESEARCH_TIMEOUT_MS = 90_000;
const MAX_SEARCH_RESULTS_QUICK = 5;
const MAX_SEARCH_RESULTS_DEEP = 5;
const MAX_CRAWL_URLS_DEEP = 2;
const MAX_PAGES_PER_URL_DEEP = 2;
const MAX_SNIPPET_CHARS = 3000;

function getTavilyClient() {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is required to run web_research.");
  }

  return tavily({ apiKey });
}

function resolveDepth(config: WebResearchConfig): WebResearchDepth {
  return config.depth === "deep" ? "deep" : "quick";
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function rollingDateWindow(days: number): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function formatSearchSection(topic: string, search: TavilySearchResponse): string {
  const lines = [
    `# Web research: ${topic}`,
    "",
    "## Search overview",
    `Query: ${search.query ?? topic}`,
  ];

  if (typeof search.response_time === "number") {
    lines.push(`Response time: ${search.response_time.toFixed(2)}s`);
  }

  lines.push("", "## Search results");

  for (const [index, hit] of (search.results ?? []).entries()) {
    lines.push(
      `${index + 1}. ${hit.title ?? hit.url}`,
      `   URL: ${hit.url}`,
      hit.score !== undefined ? `   Score: ${hit.score.toFixed(4)}` : "",
      hit.content ? `   Snippet: ${hit.content.slice(0, 800)}` : "",
      "",
    );
  }

  return lines.filter((line) => line.length > 0).join("\n");
}

function formatCrawlSection(sections: string[]): string {
  if (sections.length === 0) {
    return "## Crawled sources\nNo crawl content retrieved; search snippets only.";
  }

  return ["## Crawled sources", ...sections].join("\n\n");
}

async function runQuickResearch(client: ReturnType<typeof getTavilyClient>, topic: string): Promise<string> {
  const { startDate, endDate } = rollingDateWindow(14);
  const search = (await client.search(topic, {
    topic: "news",
    searchDepth: "basic",
    maxResults: MAX_SEARCH_RESULTS_QUICK,
    startDate,
    endDate,
    includeUsage: true,
  })) as TavilySearchResponse;

  return formatSearchSection(topic, search);
}

async function runDeepResearch(client: ReturnType<typeof getTavilyClient>, topic: string): Promise<string> {
  const { startDate, endDate } = rollingDateWindow(14);

  const search = (await client.search(topic, {
    topic: "news",
    searchDepth: "advanced",
    maxResults: MAX_SEARCH_RESULTS_DEEP,
    startDate,
    endDate,
    includeUsage: true,
  })) as TavilySearchResponse;

  const urls = (search.results ?? [])
    .map((hit) => hit.url)
    .filter((url): url is string => typeof url === "string" && url.length > 0)
    .slice(0, MAX_CRAWL_URLS_DEEP);

  const crawlSections: string[] = [];

  for (const url of urls) {
    try {
      const crawl = (await withTimeout(
        client.crawl(url, {
          limit: 6,
          maxDepth: 1,
          extractDepth: "basic",
        }) as Promise<TavilyCrawlResponse>,
        20_000,
        `Tavily crawl for ${url}`,
      )) as TavilyCrawlResponse;

      for (const page of (crawl.results ?? []).slice(0, MAX_PAGES_PER_URL_DEEP)) {
        if (!page.raw_content) {
          continue;
        }

        crawlSections.push(
          `### ${page.url}\n${page.raw_content.slice(0, MAX_SNIPPET_CHARS)}`,
        );
      }
    } catch {
      const fallback = search.results?.find((hit) => hit.url === url);
      if (fallback?.content) {
        crawlSections.push(
          `### ${url}\n${fallback.content.slice(0, MAX_SNIPPET_CHARS)}`,
        );
      }
    }
  }

  return [formatSearchSection(topic, search), formatCrawlSection(crawlSections)].join(
    "\n\n",
  );
}

export async function runWebResearch(config: WebResearchConfig): Promise<string> {
  const topic = config.topic.trim();
  if (topic.length === 0) {
    throw new Error("web_research requires a non-empty topic.");
  }

  const depth = resolveDepth(config);
  const client = getTavilyClient();
  const timeoutMs = depth === "deep" ? DEEP_RESEARCH_TIMEOUT_MS : QUICK_RESEARCH_TIMEOUT_MS;

  return withTimeout(
    depth === "deep" ? runDeepResearch(client, topic) : runQuickResearch(client, topic),
    timeoutMs,
    depth === "deep" ? "Detailed web research" : "Web research",
  );
}
