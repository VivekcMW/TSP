import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import type { InboxStatus } from "@/lib/inbox-queries";
import { newsQueryKey } from "@shared/news-search";
import type { InboxItem, SavedSearch } from "@shared/schema";

export type NewsProviderStatus = "ok" | "failed" | "skipped";
export interface NewsSearchResult {
  id: string; title: string; url: string; source: string; publishedAt: string | null; snippet: string; matchedTerms: string[];
  alsoCoveredBy: Array<{ source: string; url: string }>;
  /** The story you already have; `url` is that copy's canonical link (this result or an alsoCoveredBy copy). */
  inInbox: { id: string; status: InboxStatus; url: string } | null;
}
export interface NewsSearchResponse {
  query: { normalized: string; warnings: string[] };
  providers: { pool: NewsProviderStatus; google: NewsProviderStatus; bing: NewsProviderStatus };
  results: NewsSearchResult[];
}
/** Dates arrive as JSON strings. */
export type FollowedSearch = Omit<SavedSearch, "createdAt" | "lastViewedAt"> & { createdAt: string; lastViewedAt: string | null };

export const NEWS_SEARCH_LIMIT = 50;
export const newsSearchKey = (query: string) => ["/api/search/news", query] as const;
export const SAVED_SEARCHES_KEY = ["/api/searches"] as const;

export const newsSearchQuery = (query: string, enabled = true) => ({
  queryKey: newsSearchKey(query),
  queryFn: async ({ signal }: { signal: AbortSignal }): Promise<NewsSearchResponse> =>
    (await apiRequest("GET", `/api/search/news?q=${encodeURIComponent(query)}&limit=${NEWS_SEARCH_LIMIT}`, undefined, { signal })).json(),
  enabled: enabled && Boolean(query.trim()),
  // Fresh enough for a session; the server caches provider results briefly as well.
  staleTime: 2 * 60_000,
});

/** Followed searches; an older server without the endpoint simply has none. */
export const savedSearchesQuery = (enabled = true) => ({
  queryKey: SAVED_SEARCHES_KEY,
  queryFn: async ({ signal }: { signal: AbortSignal }): Promise<FollowedSearch[]> => {
    try { return await (await apiRequest("GET", "/api/searches", undefined, { signal })).json(); }
    catch (error) { if (error instanceof ApiError && error.status === 404) return []; throw error; }
  },
  enabled,
  staleTime: 60_000,
});

export const findFollowed = (searches: readonly FollowedSearch[] | undefined, query: string) => {
  const key = newsQueryKey(query);
  return (searches ?? []).find(search => newsQueryKey(search.query) === key) ?? null;
};

export const refreshSavedSearches = () => queryClient.invalidateQueries({ queryKey: SAVED_SEARCHES_KEY });

export async function followSearch(query: string, name?: string): Promise<FollowedSearch> {
  return (await apiRequest("POST", "/api/searches", { query, ...(name ? { name } : {}) })).json();
}
export async function unfollowSearch(id: string): Promise<void> {
  await apiRequest("DELETE", `/api/searches/${encodeURIComponent(id)}`);
}
export async function markSearchViewed(id: string): Promise<void> {
  await apiRequest("POST", `/api/searches/${encodeURIComponent(id)}/viewed`);
}

/** The copy of this story to act on: the one already in your Inbox (maybe another outlet's), else the result itself. */
export function inboxCopyOf(result: NewsSearchResult): { url: string; source: string } {
  const url = result.inInbox?.url ?? result.url;
  return { url, source: result.alsoCoveredBy.find(entry => entry.url === url)?.source ?? result.source };
}

/**
 * Saves a result to the Shortlist (or returns the story you already have) and refreshes Inbox lists.
 * A copy you marked not relevant is saved by its own link, so it moves to the Shortlist instead of duplicating.
 */
export async function saveNewsResult(result: NewsSearchResult): Promise<InboxItem> {
  const copy = inboxCopyOf(result);
  const item: InboxItem = await (await apiRequest("POST", "/api/search/news/save", {
    url: copy.url, title: result.title.slice(0, 500), source: copy.source.slice(0, 200),
    publishedAt: result.publishedAt, snippet: result.snippet ? result.snippet.slice(0, 1000) : null,
  })).json();
  const inInbox = { id: item.id, status: item.status as InboxStatus, url: copy.url };
  queryClient.setQueriesData<NewsSearchResponse>({ queryKey: ["/api/search/news"] }, current => current && {
    ...current, results: current.results.map(entry => entry.id === result.id || entry.url === result.url ? { ...entry, inInbox } : entry),
  });
  void queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
  return item;
}

export const inboxStateLabel = (status: InboxStatus) => ({ saved: "In your Shortlist", active: "In For you", dismissed: "In Not relevant" })[status];
