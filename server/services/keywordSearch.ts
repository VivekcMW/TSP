import { getSearchEdition } from "@shared/search-editions";
import { SEARCH_QUERY_LIMITS } from "@shared/search-query-plan";
import type { FetchedArticle } from "./engines/types.js";
import { PublicationFeedParser, stripHtml } from "./universalFeedParser.js";
import { publicationDate } from "./articleDates";
import { sourceOrigin } from "./inboxDiversity";
import type { PublicationDate } from "@shared/article-quality";
import { CrawlError, fetchPublicText } from "./crawlerFetch.js";

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
    return items.slice(0, limit).map((item) => {
      const date = (item as typeof item & { publicationDate?: PublicationDate }).publicationDate ?? publicationDate(item.pubDate, "rss-pubDate");
      const source = (item as GoogleNewsItem).rawSource?.[0];
      return ({
      title: item.title || "Untitled",
      link: item.link || "",
      pubDate: date.publishedAt, publishedAt: date.publishedAt, publicationDate: date,
      inputKind: "provider_excerpt" as const,
      sourceOrigin: sourceOrigin(typeof source === "object" ? source.$?.url : null),
      source: extractSourceName(item as GoogleNewsItem, "Google News"),
      content: stripHtml(item.contentSnippet || item.content || item.summary || ""),
      categories: [trimmed],
    }); }).filter((article) => article.link);
  } catch {
    console.error("[keywordSearch] Search request failed or was cancelled.");
    throw new CrawlError("search", "Article search failed or was cancelled. Please try again.");
  }
}
