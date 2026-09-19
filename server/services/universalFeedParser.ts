import Parser from "rss-parser";
import type { ArticleInputKind, PublicationDate } from "@shared/article-quality";
import { publicationDate } from "./articleDates";

/** rss-parser's Atom adapter substitutes updated and throws on invalid dates.
 * Call its content adapter with dates removed; retain ONLY raw published here.
 * This application subclass is covered against actual rss-parser XML fixtures.
 */
export class PublicationFeedParser extends Parser {
  parseItemAtom(entry: Record<string, unknown>) {
    const { published, updated: _updated, ...content } = entry;
    const base = Parser.prototype as unknown as { parseItemAtom(value: Record<string, unknown>): Record<string, unknown> };
    const item = base.parseItemAtom.call(this, content);
    const raw = Array.isArray(published) ? published[0] : undefined;
    const date = publicationDate(typeof raw === "object" && raw ? (raw as { _?: string })._ : raw, "atom-published");
    return { ...item, pubDate: date.publishedAt, publicationDate: date };
  }
}

/**
 * One parser for every feed format Discover deals with (RSS 2.0, Atom, and
 * JSON Feed) plus the text-cleanup helpers shared by both feed fetching and
 * live keyword search, so "compiled" article content is consistently plain
 * text everywhere, not just wherever someone remembered to strip HTML.
 */

export interface ParsedFeedItem {
  title: string;
  link: string;
  /** Compatibility alias, validated publication only. */
  pubDate: string | null;
  publishedAt?: string | null;
  publicationDate?: PublicationDate;
  inputKind?: ArticleInputKind;
  sourceOrigin?: string | null;
  content: string;
  categories: string[];
}

const rssAtomParser = new PublicationFeedParser({
  timeout: 8000,
  headers: { "User-Agent": "TheSocialPundit/1.0 (Feed Reader)" },
});

export function stripHtml(input: string): string {
  return input.replace(/<[^>]{0,500}>/g, " ").replace(/\s+/g, " ").trim();
}

/** Unicode-preserving normalization, not semantic story equivalence. */
export function normalizeTitleForDedup(title: string): string {
  return title
    .normalize("NFKC").toLowerCase()
    .replace(/&#\d+;|&[a-z]+;/g, " ")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
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
    return parsed.items.map((item) => {
      const date = publicationDate(item.date_published, "json-date_published");
      return ({
      title: item.title || "Untitled",
      link: item.url || item.id || "",
      pubDate: date.publishedAt, publishedAt: date.publishedAt, publicationDate: date, inputKind: "feed_excerpt" as const,
      content: stripHtml(item.content_text || item.content_html || item.summary || ""),
      categories: item.tags || [],
    }); });
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
    return items.map((item) => {
      const date = (item as typeof item & { publicationDate?: PublicationDate }).publicationDate ?? publicationDate(item.pubDate, "rss-pubDate");
      return ({
      title: item.title || "Untitled",
      link: item.link || "",
      pubDate: date.publishedAt, publishedAt: date.publishedAt, publicationDate: date, inputKind: "feed_excerpt" as const,
      content: stripHtml(item.contentSnippet || item.content || item.summary || ""),
      categories: item.categories || [],
    }); });
  } catch {
    // Last resort: maybe it's JSON Feed without the exact version string we checked for.
    return parseJsonFeed(text);
  }
}
