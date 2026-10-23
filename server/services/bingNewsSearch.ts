import { getSearchEdition, type SearchEditionId } from "@shared/search-editions";
import { SEARCH_QUERY_LIMITS } from "@shared/search-query-plan";
import { canonicalHttpUrl } from "@shared/canonical-url";
import type { FetchedArticle } from "./engines/types.js";
import { PublicationFeedParser, stripHtml } from "./universalFeedParser.js";
import { publicationDate } from "./articleDates";
import { sourceOrigin } from "./inboxDiversity";
import { CrawlError, fetchPublicText } from "./crawlerFetch.js";

/**
 * Bing News search, run next to Google News. Bing's RSS carries each story's publisher link
 * inside its click-through address, so nothing has to be decoded. From Cloud Run, Google's
 * decoders kept 18 of 64 stories inside a refresh's time budget, while Bing answered each
 * search in about 0.3 s with direct links.
 */

const parser = new PublicationFeedParser({ customFields: { item: [["News:Source", "newsSource"]] } });
// Bing's "past month" filter; without it, niche searches return articles years old.
const PAST_MONTH = 'interval="9"';
// Bing's market filter still lets other languages through (3 Chinese headlines in 12 for an
// English search), so headlines must use the edition's script. Other editions are Latin-script.
const EDITION_SCRIPT: Partial<Record<SearchEditionId, RegExp>> = {
  "ja-JP": /[\p{Script=Hiragana}\p{Script=Katakana}]/u,
  "hi-IN": /\p{Script=Devanagari}/u,
};
const NON_LATIN_LETTER = /(?=\p{L})\P{Script=Latin}/u;

function inEditionScript(title: string, edition: SearchEditionId) {
  const required = EDITION_SCRIPT[edition];
  return required ? required.test(title) : !NON_LATIN_LETTER.test(title);
}

/** The publisher link inside a Bing News click-through address, or null. MSN copies are
 * left out: they render in the browser, so they can't be read to write a post. */
export function bingPublisherUrl(link: string): string | null {
  try {
    const url = new URL(link);
    if (!/(^|\.)bing\.com$/.test(url.hostname) || url.pathname !== "/news/apiclick.aspx") return null;
    const target = canonicalHttpUrl(url.searchParams.get("url") ?? "");
    if (!target || /(^|\.)(bing|msn)\.com$/.test(new URL(target).hostname)) return null;
    return target;
  } catch {
    return null;
  }
}

export async function fetchBingArticlesForQuery(
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

  // Edition ids are Bing market codes too (en-IN, pt-BR, ja-JP, hi-IN…).
  const edition = getSearchEdition(searchEdition).id;
  const url = new URL("https://www.bing.com/news/search");
  url.search = new URLSearchParams({ q: trimmed, format: "rss", setmkt: edition, qft: PAST_MONTH }).toString();

  try {
    const response = await fetchPublicText(url.href, { signal, timeoutMs: 8000 });
    signal?.throwIfAborted();
    const feed = await parser.parseString(response.text);
    return (feed.items || []).flatMap((item): FetchedArticle[] => {
      const link = bingPublisherUrl(item.link || "");
      if (!link || !inEditionScript(item.title || "", edition)) return [];
      const date = publicationDate(item.pubDate, "rss-pubDate");
      const source = String((item as { newsSource?: unknown }).newsSource ?? "").replace(/\s+on MSN$/i, "").trim();
      return [{
        title: item.title || "Untitled",
        link,
        pubDate: date.publishedAt, publishedAt: date.publishedAt, publicationDate: date,
        inputKind: "provider_excerpt",
        sourceOrigin: sourceOrigin(link),
        source: source || new URL(link).hostname.replace(/^www\./, ""),
        content: stripHtml(item.contentSnippet || item.content || item.summary || ""),
        categories: [trimmed],
      }];
    }).slice(0, limit);
  } catch {
    console.error("[bingNewsSearch] Search request failed or was cancelled.");
    throw new CrawlError("search", "Article search failed or was cancelled. Please try again.");
  }
}
