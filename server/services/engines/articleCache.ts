import type { FetchedArticle } from "./types.js";

/** Process-local provider-result optimization, NOT a distributed cache or quota. */
export const ARTICLE_CACHE_LIMITS = Object.freeze({
  ttlMs: 10 * 60 * 1000,
  maxEntries: 128,
  maxEntryBytes: 512 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxKeyBytes: 4 * 1024,
  maxInFlight: 8,
  maxConsumersPerKey: 32,
  maxConsumers: 128,
  maxArticles: 256,
  maxCategoriesPerArticle: 64,
});

export class ArticleCacheError extends Error {
  constructor(public readonly code: "busy" | "key" | "result" | "fetch") {
    super(code === "busy"
      ? "Article search is busy. Please try again shortly."
      : "Article search could not complete. Please try again.");
    this.name = "ArticleCacheError";
  }
}

interface CacheEntry {
  json: string;
  bytes: number;
  expiresAt: number;
}
interface PendingEntry {
  promise: Promise<string>;
  consumers: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, PendingEntry>();
let totalBytes = 0;
let consumers = 0;

function removeEntry(key: string, entry: CacheEntry): void {
  cache.delete(key);
  totalBytes -= entry.bytes;
}

function evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) removeEntry(key, entry);
  }
}

/** Allowlist public provider fields; never share trusted user-source metadata. */
function serializeArticles(articles: FetchedArticle[], keyBytes: number): string {
  if (!Array.isArray(articles) || articles.length > ARTICLE_CACHE_LIMITS.maxArticles) {
    throw new ArticleCacheError("result");
  }
  // Bound traversal/allocation BEFORE serializing (escaping can add up to 6x).
  let rawBytes = keyBytes;
  const text = (value: unknown): string => {
    if (typeof value !== "string" || value.length > ARTICLE_CACHE_LIMITS.maxEntryBytes) {
      throw new ArticleCacheError("result");
    }
    rawBytes += Buffer.byteLength(value, "utf8");
    if (rawBytes > ARTICLE_CACHE_LIMITS.maxEntryBytes) throw new ArticleCacheError("result");
    return value;
  };
  const snapshot: FetchedArticle[] = [];
  for (const article of articles) {
    if (!article || typeof article !== "object" || "userSourceProvenance" in article
      || !Array.isArray(article.categories)
      || article.categories.length > ARTICLE_CACHE_LIMITS.maxCategoriesPerArticle) {
      throw new ArticleCacheError("result");
    }
    snapshot.push({
      title: text(article.title), link: text(article.link), pubDate: article.pubDate === null ? null : text(article.pubDate),
      source: text(article.source), content: text(article.content),
      categories: Array.from(article.categories, text),
      ...(article.publishedAt !== undefined ? { publishedAt: article.publishedAt === null ? null : text(article.publishedAt) } : {}),
      ...(article.sourceOrigin !== undefined ? { sourceOrigin: article.sourceOrigin === null ? null : text(article.sourceOrigin) } : {}),
      ...(article.inputKind !== undefined ? { inputKind: text(article.inputKind) as FetchedArticle["inputKind"] } : {}),
      ...(article.publicationDate ? { publicationDate: {
        publishedAt: article.publicationDate.publishedAt === null ? null : text(article.publicationDate.publishedAt),
        publicationDateSource: text(article.publicationDate.publicationDateSource) as NonNullable<FetchedArticle["publicationDate"]>["publicationDateSource"],
        precision: text(article.publicationDate.precision) as NonNullable<FetchedArticle["publicationDate"]>["precision"],
        quality: text(article.publicationDate.quality) as NonNullable<FetchedArticle["publicationDate"]>["quality"],
        ...(article.publicationDate.day !== undefined ? { day: text(article.publicationDate.day) } : {}),
      } } : {}),
    });
  }
  return JSON.stringify(snapshot);
}

/**
 * Exact opaque keys are used identically for hits and coalescing: callers must
 * include every provider/result dimension (current caller uses edition + ordered
 * queries as JSON). No trimming, case folding, sorting or delimiter rewriting.
 * Fetchers MUST return public provider data, never tenant/private/scored results;
 * rejecting provenance and allowlisting fields is defense in depth, not an ACL.
 *
 * UTF-8 key + serialized payload bytes are charged (not an exact V8 heap bound).
 * TTL starts on successful completion and is not extended by reads. Expired
 * entries are swept on access/insertion, then LRU entries evicted for capacity.
 * Idle expired entries may remain resident, within the same fixed bounds.
 *
 * No queue, bypass fetch, retry, background sweep, or detached timeout race.
 * Fetchers own cooperative deadlines; an uncooperative fetch holds its bounded
 * slot until it settles. Every consumer, including the leader, gets a fresh copy.
 */
export async function getCachedArticles(
  key: string,
  fetcher: () => Promise<FetchedArticle[]>,
  shouldCache: (articles: FetchedArticle[]) => boolean = () => true,
): Promise<FetchedArticle[]> {
  if (typeof key !== "string" || !key.length || key.length > ARTICLE_CACHE_LIMITS.maxKeyBytes) {
    throw new ArticleCacheError("key");
  }
  const keyBytes = Buffer.byteLength(key, "utf8");
  if (keyBytes > ARTICLE_CACHE_LIMITS.maxKeyBytes) throw new ArticleCacheError("key");
  evictExpired();
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return JSON.parse(cached.json) as FetchedArticle[];
  }

  let pending = inFlight.get(key);
  if (consumers >= ARTICLE_CACHE_LIMITS.maxConsumers
    || (pending && pending.consumers >= ARTICLE_CACHE_LIMITS.maxConsumersPerKey)
    || (!pending && inFlight.size >= ARTICLE_CACHE_LIMITS.maxInFlight)) {
    throw new ArticleCacheError("busy");
  }
  if (!pending) {
    // Register before invoking user code, including synchronously throwing fetchers.
    const promise = Promise.resolve().then(fetcher).then(articles => {
      const json = serializeArticles(articles, keyBytes);
      if (!shouldCache(articles)) return json;
      const bytes = keyBytes + Buffer.byteLength(json, "utf8");
      // Reject the entire batch, never silently truncate or return an unbounded copy.
      if (bytes > ARTICLE_CACHE_LIMITS.maxEntryBytes) throw new ArticleCacheError("result");
      evictExpired();
      while (cache.size >= ARTICLE_CACHE_LIMITS.maxEntries
        || totalBytes + bytes > ARTICLE_CACHE_LIMITS.maxTotalBytes) {
        const [oldestKey, oldest] = cache.entries().next().value!;
        removeEntry(oldestKey, oldest);
      }
      cache.set(key, { json, bytes, expiresAt: Date.now() + ARTICLE_CACHE_LIMITS.ttlMs });
      totalBytes += bytes;
      return json;
    }).catch(error => {
      // Provider errors can contain query text, credentials or private URLs.
      throw new ArticleCacheError(error instanceof ArticleCacheError ? error.code : "fetch");
    }).finally(() => {
      inFlight.delete(key);
    });
    pending = { promise, consumers: 0 };
    inFlight.set(key, pending);
  }
  pending.consumers++;
  consumers++;
  try {
    return JSON.parse(await pending.promise) as FetchedArticle[];
  } finally {
    pending.consumers--;
    consumers--;
  }
}
