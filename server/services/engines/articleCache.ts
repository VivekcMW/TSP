import type { FetchedArticle } from "./types.js";

// Shared across all users of the same industry engine so concurrent
// requests don't each re-fetch/re-parse the same 10 RSS feeds.
const TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  articles: FetchedArticle[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<FetchedArticle[]>>();

export async function getCachedArticles(
  key: string,
  fetcher: () => Promise<FetchedArticle[]>,
): Promise<FetchedArticle[]> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.articles;
  }

  // Collapse concurrent cache misses for the same key into one upstream fetch.
  const pending = inFlight.get(key);
  if (pending !== undefined) return pending;

  const promise = fetcher()
    .then((articles) => {
      cache.set(key, { articles, expiresAt: Date.now() + TTL_MS });
      return articles;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}
