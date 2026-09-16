import Parser from "rss-parser";

/**
 * One parser for every feed format Discover deals with (RSS 2.0, Atom, and
 * JSON Feed) plus the text-cleanup helpers shared by both feed fetching and
 * live keyword search, so "compiled" article content is consistently plain
 * text everywhere, not just wherever someone remembered to strip HTML.
 */

export interface ParsedFeedItem {
  title: string;
  link: string;
  pubDate: string;
  content: string;
  categories: string[];
}

const rssAtomParser = new Parser({
  timeout: 8000,
  headers: { "User-Agent": "TheSocialPundit/1.0 (Feed Reader)" },
});

export function stripHtml(input: string): string {
  return input.replace(/<[^>]{0,500}>/g, " ").replace(/\s+/g, " ").trim();
}

/** Lowercase, punctuation-stripped title for fuzzy dedup — catches syndicated re-headlines of the same story across outlets that a strict URL match would miss. */
export function normalizeTitleForDedup(title: string): string {
  return title
    .toLowerCase()
    .replace(/&#\d+;|&[a-z]+;/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface JsonFeedItem {
  id?: string;
  url?: string;
  title?: string;
  content_text?: string;
  content_html?: string;
  summary?: string;
  date_published?: string;
  tags?: string[];
}

function looksLikeJsonFeed(text: string): boolean {
  return /^\s*\{/.test(text) && /"version"\s*:\s*"https:\/\/jsonfeed\.org/.test(text.slice(0, 500));
}

function parseJsonFeed(text: string): ParsedFeedItem[] | null {
  try {
    const parsed = JSON.parse(text) as { items?: JsonFeedItem[] };
    if (!Array.isArray(parsed.items)) return null;
    return parsed.items.map((item) => ({
      title: item.title || "Untitled",
      link: item.url || item.id || "",
      pubDate: item.date_published || new Date().toISOString(),
      content: stripHtml(item.content_text || item.content_html || item.summary || ""),
      categories: item.tags || [],
    }));
  } catch {
    return null;
  }
}

/**
 * Parses raw feed text (already fetched by the caller) as JSON Feed, RSS, or
 * Atom — whichever it actually is — and returns a normalized, HTML-free item
 * list. Returns null if none of the formats parse.
 */
export async function parseFeedContent(text: string): Promise<ParsedFeedItem[] | null> {
  if (looksLikeJsonFeed(text)) {
    const jsonItems = parseJsonFeed(text);
    if (jsonItems) return jsonItems;
  }

  try {
    const feed = await rssAtomParser.parseString(text);
    const items = feed.items || [];
    if (items.length === 0) return null;
    return items.map((item) => ({
      title: item.title || "Untitled",
      link: item.link || "",
      pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
      content: stripHtml(item.contentSnippet || item.content || item.summary || ""),
      categories: item.categories || [],
    }));
  } catch {
    // Last resort: maybe it's JSON Feed without the exact version string we checked for.
    return parseJsonFeed(text);
  }
}
