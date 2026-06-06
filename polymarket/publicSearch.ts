import { toEssentialMarket } from "./getMarkets";
import type {
  EssentialGammaMarket,
  GammaMarket,
  PublicSearchEvent,
  PublicSearchParams,
  PublicSearchResponse,
} from "../types/polymarket";

export const DEFAULT_GAMMA_API_URL = "https://gamma-api.polymarket.com";

type GammaSearchEvent = {
  id: string;
  title?: string;
  slug?: string;
  description?: string;
  active?: boolean;
  closed?: boolean;
  volume?: number;
  liquidity?: number;
  markets?: GammaMarket[];
};

type GammaSearchResponse = {
  events?: GammaSearchEvent[];
  tags?: PublicSearchResponse["tags"];
  pagination?: PublicSearchResponse["pagination"];
};

function compactEvent(event: GammaSearchEvent): PublicSearchEvent {
  const markets = (event.markets ?? []).map((market) => toEssentialMarket(market));
  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    description: event.description,
    active: event.active,
    closed: event.closed,
    volume: event.volume,
    liquidity: event.liquidity,
    markets: markets as EssentialGammaMarket[],
  };
}

/**
 * Searches Polymarket events, markets, and tags via Gamma public-search.
 */
export async function publicSearch({
  q,
  limitPerType = 5,
  page,
  eventsStatus,
  eventsTag,
  keepClosedMarkets,
  sort,
  ascending,
  searchTags = true,
  searchProfiles = false,
  cache,
  gammaApiUrl = DEFAULT_GAMMA_API_URL,
  signal,
}: PublicSearchParams): Promise<PublicSearchResponse> {
  const query = q.trim();
  if (!query) {
    throw new Error("q is required.");
  }

  const url = new URL("/public-search", gammaApiUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("limit_per_type", String(limitPerType));
  url.searchParams.set("search_tags", String(searchTags));
  url.searchParams.set("search_profiles", String(searchProfiles));

  if (page !== undefined) {
    url.searchParams.set("page", String(page));
  }
  if (eventsStatus) {
    url.searchParams.set("events_status", eventsStatus);
  }
  if (keepClosedMarkets !== undefined) {
    url.searchParams.set("keep_closed_markets", String(keepClosedMarkets));
  }
  if (sort) {
    url.searchParams.set("sort", sort);
  }
  if (ascending !== undefined) {
    url.searchParams.set("ascending", String(ascending));
  }
  if (cache !== undefined) {
    url.searchParams.set("cache", String(cache));
  }
  if (eventsTag?.length) {
    for (const tag of eventsTag) {
      url.searchParams.append("events_tag", tag);
    }
  }

  const response = await fetch(url, { signal });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Gamma publicSearch failed (${response.status} ${response.statusText}): ${errorText}`,
    );
  }

  const body = (await response.json()) as GammaSearchResponse;
  return {
    events: (body.events ?? []).map(compactEvent),
    tags: body.tags,
    pagination: body.pagination,
  };
}
