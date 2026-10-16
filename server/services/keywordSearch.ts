import { getSearchEdition } from "@shared/search-editions";
import { SEARCH_QUERY_LIMITS } from "@shared/search-query-plan";
import type { FetchedArticle } from "./engines/types.js";
import { PublicationFeedParser, stripHtml } from "./universalFeedParser.js";
import { publicationDate } from "./articleDates";
import { sourceOrigin } from "./inboxDiversity";
import type { PublicationDate } from "@shared/article-quality";
import { CrawlError, fetchPublicText, mapCrawlSettled } from "./crawlerFetch.js";
import { canonicalHttpUrl } from "@shared/canonical-url";
import { decodeGoogleNewsUrl, tryOfflineDecode } from "decode-google-news-url";
import GoogleNewsDecoder from "google-news-decoder";

/**
 * Live, keyword-driven article discovery. The query is the user's own
 * keyword/company/influencer text — there is no per-industry preset list
 * behind this, so results are inherently scoped to what that specific user
 * typed. Uses Google News RSS search: free, no API key, works for any query.
 */

interface GoogleNewsItem {
  source?: string | { _: string; $?: { url?: string } };
  rawSource?: Array<{ _: string; $?: { url?: string } }>;
}

const parser = new PublicationFeedParser({
  customFields: { item: ["source", ["source", "rawSource", { keepArray: true }]] },
});

function extractSourceName(item: GoogleNewsItem, fallback: string): string {
  const { source } = item;
  if (typeof source === "string" && source.trim()) return source.trim();
  if (source && typeof source === "object" && "_" in source && typeof source._ === "string") return source._;
  return fallback;
}

export function isGoogleNewsArticleUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === "news.google.com" && /^\/(rss\/)?(articles|read)\//.test(url.pathname);
  } catch {
    return false;
  }
}

// Google News article ids never change target, so a decoded link is kept for the life of the
// process (production runs one instance). Refreshes every 30 minutes see the same stories.
const DECODED_LINK_LIMIT = 5000;
const decodedLinks = new Map<string, string>();

function rememberDecodedLink(articleId: string, url: string) {
  if (decodedLinks.size >= DECODED_LINK_LIMIT) decodedLinks.delete(decodedLinks.keys().next().value!);
  decodedLinks.set(articleId, url);
  return url;
}

function directUrl(decoded: unknown): string {
  const value = typeof decoded === "string" ? decoded : (decoded as { decodedUrl?: unknown } | null)?.decodedUrl;
  const direct = typeof value === "string" ? canonicalHttpUrl(value) : null;
  if (!direct || isGoogleNewsArticleUrl(direct)) throw new Error("No publisher link");
  return direct;
}

/**
 * Google News RSS exposes an opaque tracking article URL; resolve it before persisting it in Discover.
 * The decoders run one after the other on purpose: Google throttles requests from Cloud Run, and
 * asking both at once doubled the requests and made decoding slower. Returns `value` unchanged
 * when neither decoder answers.
 */
export async function resolveGoogleNewsArticleUrl(value: string, signal?: AbortSignal, timeoutMs = 1500): Promise<string> {
  if (!isGoogleNewsArticleUrl(value)) return value;
  const articleId = new URL(value).pathname.split("/").pop() ?? "";
  const known = decodedLinks.get(articleId);
  if (known) return known;
  const offline = canonicalHttpUrl(tryOfflineDecode(articleId) ?? "");
  if (offline && !isGoogleNewsArticleUrl(offline)) return rememberDecodedLink(articleId, offline);
  for (const decode of [() => new GoogleNewsDecoder().decodeGoogleNewsUrl(value), () => decodeGoogleNewsUrl(value)]) {
    if (signal?.aborted) return value;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const decoded = await Promise.race([
        Promise.resolve().then(decode).then(directUrl),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Google News decode timed out")), timeoutMs); }),
      ]);
      return rememberDecodedLink(articleId, decoded);
    } catch {
      // Consent walls, rate limits and slow decoder endpoints must not block refresh.
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return value;
}

/** `link` is the Google News article page, which a browser follows to the story; it is never fetched here. */
export interface NewsHeadline { title: string; source: string; sourceUrl: string | null; publishedAt: string | null; link: string | null }

function googleNewsLink(value?: string): string | null {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && url.hostname === "news.google.com" ? url.href : null;
  } catch { return null; }
}

/** Recent headlines with their publication, for onboarding suggestions. Article links are not resolved. */
export async function fetchNewsHeadlines(query: string, searchEdition = "en-US", signal?: AbortSignal): Promise<NewsHeadline[]> {
  if (typeof query !== "string" || query.length > SEARCH_QUERY_LIMITS.term) return [];
  const trimmed = query.trim();
  if (!trimmed) return [];
  const { hl, gl, ceid } = getSearchEdition(searchEdition);
  const url = new URL("https://news.google.com/rss/search");
  url.search = new URLSearchParams({ q: `${trimmed} when:30d`, hl, gl, ceid }).toString();
  const response = await fetchPublicText(url.href, { signal, timeoutMs: 6000 });
  const feed = await parser.parseString(response.text);
  return (feed.items || []).slice(0, 30).flatMap(item => {
    const source = extractSourceName(item as GoogleNewsItem, "").trim();
    const rawUrl = (item as GoogleNewsItem).rawSource?.[0]?.$?.url;
    // Google appends " - <publication>" to every headline.
    const title = (item.title || "").endsWith(` - ${source}`) ? (item.title || "").slice(0, -(source.length + 3)).trim() : (item.title || "").trim();
    if (!title || !source) return [];
    return [{ title, source, sourceUrl: rawUrl ? canonicalHttpUrl(rawUrl) ?? null : null, publishedAt: publicationDate(item.pubDate, "rss-pubDate").publishedAt, link: googleNewsLink(item.link) }];
  });
}

export async function fetchArticlesForQuery(
  query: string,
  maxItems: number = 8,
  searchEdition: string = "en-US",
  signal?: AbortSignal,
): Promise<FetchedArticle[]> {
  if (signal?.aborted) throw new CrawlError("search", "Article search failed or was cancelled. Please try again.");
  if (typeof query !== "string" || query.length > SEARCH_QUERY_LIMITS.term) return [];
  const trimmed = query.trim();
  if (!trimmed) return [];
  const limit = Number.isFinite(maxItems) ? Math.max(0, Math.min(8, Math.floor(maxItems))) : 8;
  if (!limit) return [];

  const { hl, gl, ceid } = getSearchEdition(searchEdition);
  const url = new URL("https://news.google.com/rss/search");
  url.search = new URLSearchParams({ q: trimmed, hl, gl, ceid }).toString();

  try {
    const response = await fetchPublicText(url.href, { signal, timeoutMs: 8000 });
    signal?.throwIfAborted();
    const feed = await parser.parseString(response.text);
    signal?.throwIfAborted();
    const items = feed.items || [];

    // Explicit provider fields only: search results never carry trusted source provenance.
    const resolved = await mapCrawlSettled(items.slice(0, limit), 4, async (item) => {
      const date = (item as typeof item & { publicationDate?: PublicationDate }).publicationDate ?? publicationDate(item.pubDate, "rss-pubDate");
      const source = (item as GoogleNewsItem).rawSource?.[0];
      const link = await resolveGoogleNewsArticleUrl(item.link || "", signal);
      return {
        title: item.title || "Untitled",
        link,
        pubDate: date.publishedAt, publishedAt: date.publishedAt, publicationDate: date,
        inputKind: "provider_excerpt" as const,
        sourceOrigin: sourceOrigin(typeof source === "object" ? source.$?.url : null),
        source: extractSourceName(item as GoogleNewsItem, "Google News"),
        content: stripHtml(item.contentSnippet || item.content || item.summary || ""),
        categories: [trimmed],
      };
    });
    // A story whose Google News link could not be resolved cannot be read or written about,
    // so it is left out; a later refresh can find and resolve it again.
    return resolved.flatMap(result => result.status === "fulfilled" ? [result.value] : [])
      .filter(article => article.link && !isGoogleNewsArticleUrl(article.link));
  } catch {
    console.error("[keywordSearch] Search request failed or was cancelled.");
    throw new CrawlError("search", "Article search failed or was cancelled. Please try again.");
  }
}
