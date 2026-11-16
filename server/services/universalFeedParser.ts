import Parser from "rss-parser";
import type { ArticleInputKind, PublicationDate } from "@shared/article-quality";
import { publicationDate } from "./articleDates";

/** rss-parser's Atom adapter substitutes updated and throws on invalid dates.
 * Call its content adapter with dates removed; retain ONLY raw published here.
 * This application subclass is covered against actual rss-parser XML fixtures.
 */
export class PublicationFeedParser extends Parser {
  constructor(private readonly feedOptions: Parser.ParserOptions<Record<string, unknown>, Record<string, unknown>> = {}) {
    super(feedOptions);
  }

  override parseString(xml: string, callback?: Parameters<Parser["parseString"]>[1]): ReturnType<Parser["parseString"]> {
    // xml2js retains state after rootless input and can mix concurrent feeds.
    return super.parseString.call(new PublicationFeedParser(this.feedOptions), xml, callback);
  }

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

// A whole tag, even when a quoted attribute value contains ">" (embedded JSON or HTML). Linear: the
// unquoted run and quoted values alternate without overlap.
const TAG = /<[a-zA-Z/!?][^>"']{0,4000}(?:(?:"[^"]{0,20000}"|'[^']{0,20000}')[^>"']{0,4000}){0,200}>/g;

/** Text from HTML: whole tags of any length, plus a tag cut off at either end of an excerpt. */
export function stripHtml(input: string): string {
  let text = input.replace(TAG, " ");
  // An excerpt can start inside a tag (`…class="x">Text`): drop that fragment when it looks like attributes.
  const close = text.indexOf(">"), open = text.indexOf("<");
  if (close >= 0 && (open < 0 || close < open) && /=\s*["']/.test(text.slice(0, close))) text = text.slice(close + 1);
  // …or end inside one (`Text <img src="…`).
  text = text.replace(/<[a-zA-Z/!?][^<>]*$/, " ");
  return text.replace(/\s+/g, " ").trim();
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", shy: "",
  rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c", sbquo: "\u201a", bdquo: "\u201e", laquo: "\u00ab", raquo: "\u00bb",
  ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", middot: "\u00b7", bull: "\u2022", deg: "\u00b0", times: "\u00d7",
  copy: "\u00a9", reg: "\u00ae", trade: "\u2122", euro: "\u20ac", pound: "\u00a3", yen: "\u00a5", cent: "\u00a2", sect: "\u00a7",
  eacute: "\u00e9", egrave: "\u00e8", aacute: "\u00e1", agrave: "\u00e0", iacute: "\u00ed", oacute: "\u00f3", uacute: "\u00fa",
  ntilde: "\u00f1", ccedil: "\u00e7", auml: "\u00e4", ouml: "\u00f6", uuml: "\u00fc", szlig: "\u00df",
};

/** Feed text is often encoded twice ("&amp;#x27;" arrives as "&#x27;" after XML parsing); show it as text. */
export function decodeHtmlText(value: string): string {
  return value.replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]{1,8});/gi, (match, code: string) => {
    if (code[0] === "#") {
      const point = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : " ";
    }
    const name = Object.hasOwn(NAMED_ENTITIES, code) ? code : code.toLowerCase();
    return Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : match;
  });
}

/** A feed title or excerpt as plain text. */
export const feedText = (value: string): string => stripHtml(decodeHtmlText(stripHtml(value)));
export const feedTitle = (value: string | undefined): string => feedText(value ?? "") || "Untitled";

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
      title: feedTitle(item.title),
      link: item.url || item.id || "",
      pubDate: date.publishedAt, publishedAt: date.publishedAt, publicationDate: date, inputKind: "feed_excerpt" as const,
      content: feedText(item.content_text || item.content_html || item.summary || ""),
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
      title: feedTitle(item.title),
      link: item.link || "",
      pubDate: date.publishedAt, publishedAt: date.publishedAt, publicationDate: date, inputKind: "feed_excerpt" as const,
      content: feedText(item.contentSnippet || item.content || item.summary || ""),
      categories: item.categories || [],
    }); });
  } catch {
    // Last resort: maybe it's JSON Feed without the exact version string we checked for.
    return parseJsonFeed(text);
  }
}
