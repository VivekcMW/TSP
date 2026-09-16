import Parser from "rss-parser";
import type { FetchedArticle } from "./engines/types.js";
import { stripHtml } from "./universalFeedParser.js";

/**
 * Live, keyword-driven article discovery. The query is the user's own
 * keyword/company/influencer text — there is no per-industry preset list
 * behind this, so results are inherently scoped to what that specific user
 * typed. Uses Google News RSS search: free, no API key, works for any query.
 */

interface GoogleNewsItem {
  source?: string | { _: string };
}

const parser: Parser<unknown, GoogleNewsItem> = new Parser({
  timeout: 8000,
  headers: { "User-Agent": "TheSocialPundit/1.0 (Keyword Discovery)" },
  customFields: { item: ["source"] },
});

function extractSourceName(item: GoogleNewsItem, fallback: string): string {
  const { source } = item;
  if (typeof source === "string" && source.trim()) return source.trim();
  if (source && typeof source === "object" && "_" in source && typeof source._ === "string") return source._;
  return fallback;
}

export async function fetchArticlesForQuery(query: string, maxItems: number = 8): Promise<FetchedArticle[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(trimmed)}&hl=en-US&gl=US&ceid=US:en`;

  try {
    const feed = await parser.parseURL(url);
    const items = feed.items || [];

    return items.slice(0, maxItems).map((item) => ({
      title: item.title || "Untitled",
      link: item.link || "",
      pubDate: item.pubDate || new Date().toISOString(),
      source: extractSourceName(item, "Google News"),
      content: stripHtml(item.contentSnippet || item.content || item.summary || ""),
      categories: [trimmed],
    })).filter((article) => article.link);
  } catch (error) {
    console.error(`[keywordSearch] Failed to search for "${trimmed}":`, error instanceof Error ? error.message : error);
    return [];
  }
}
