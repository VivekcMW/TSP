import { CrawlError, fetchPublicText, mapCrawlSettled } from "./crawlerFetch.js";
import { cleanPageHtml, isSingleArticle, requireReadableHtml } from "./crawlerHtml.js";
import { extractArticleFromHtml, fetchArticleFromUrl, type FetchedArticle } from "./urlFetcher.js";
import type { ParsedFeedItem } from "./universalFeedParser.js";
import { stripHtml } from "./universalFeedParser.js";
import { sourceOrigin } from "./inboxDiversity";

/**
 * Fallback content source for any public webpage that has no discoverable
 * RSS/Atom/JSON feed (feedDiscovery.ts already tried everything realistic
 * before handing off here). Two modes, chosen automatically:
 *
 *   1. Listing mode — the page links to several distinct sub-pages that look
 *      like content (e.g. a blog index, or a help-center collection listing
 *      its articles). Fetch a bounded set of linked article bodies; failed
 *      links are skipped, never represented as title-only articles.
 *   2. Single-page mode — too few listing-like links were found, so the page
 *      itself is treated as one article, using its <title> and meta
 *      description as the headline/summary.
 *
 * Re-fetched on every refresh; dedup against existing inbox items happens
 * downstream by URL, same as real feeds.
 */

const MIN_LISTING_LINKS = 3;
const MAX_ARTICLES = 10;
const MIN_LINK_TEXT_LENGTH = 12;

const JUNK_HREF_RE = /^(#|javascript:|mailto:|tel:|sms:)/i;
const JUNK_PATH_RE = /^\/?(login|signin|sign-in|signup|sign-up|logout|sign-out|register|cart|checkout|privacy|terms|cookies?)\/?$/i;

/** A same-origin link with enough visible text to plausibly be content, not nav/footer chrome. */
function resolveQualifyingLink(href: string, innerHtml: string, baseUrl: string, pageHost: string): { title: string; link: string } | null {
  if (JUNK_HREF_RE.test(href)) return null;

  const text = stripHtml(innerHtml).trim();
  if (text.length < MIN_LINK_TEXT_LENGTH) return null;

  let resolved: URL;
  try {
    resolved = new URL(href, baseUrl);
  } catch {
    return null;
  }
  if (resolved.origin !== pageHost || !/^https?:$/.test(resolved.protocol)) return null;
  if (resolved.username || resolved.password) return null;
  resolved.hash = "";
  if (JUNK_PATH_RE.test(resolved.pathname)) return null;
  if (resolved.toString() === baseUrl.split("#")[0]) return null;

  return { title: text, link: resolved.toString() };
}

/** Same-origin anchors with enough visible text to plausibly be content, not nav/footer chrome. */
export function extractListingLinks(html: string, baseUrl: string): Array<{ title: string; link: string }> {
  const pageHost = new URL(baseUrl).origin;
  html = cleanPageHtml(html);
  const found: Array<{ title: string; link: string }> = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b[^>]{0,300}\bhref=["']([^"']+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) !== null) {
    const qualifying = resolveQualifyingLink(match[1], match[2], baseUrl, pageHost);
    if (!qualifying || seen.has(qualifying.link)) continue;
    seen.add(qualifying.link);
    found.push(qualifying);
    if (found.length >= MAX_ARTICLES) break;
  }
  return found;
}

/**
 * Scrapes a webpage (no feed available) into feed-item-shaped entries.
 * Throws on inaccessible/unreadable sources so status tracking stays honest.
 * Individual failed listing links are skipped if other articles were readable.
 */
export async function scrapeWebpageArticles(url: string, parentSignal?: AbortSignal): Promise<ParsedFeedItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
  const toItem = (article: FetchedArticle): ParsedFeedItem => ({
    title: article.title, link: article.url, content: article.content,
    pubDate: article.publishedAt ?? null, publishedAt: article.publishedAt ?? null,
    publicationDate: article.publicationDate, inputKind: "page_body", sourceOrigin: sourceOrigin(article.url), categories: [],
  });
  try {
    const page = await fetchPublicText(url, { signal, timeoutMs: 6000 });
    requireReadableHtml(page);
    const listingLinks = extractListingLinks(page.text, page.url);
    if (isSingleArticle(page.text) || listingLinks.length < MIN_LISTING_LINKS) {
      return [toItem(extractArticleFromHtml(page.text, page.url))];
    }
    const results = await mapCrawlSettled(listingLinks, 2, async (item) => {
      signal.throwIfAborted();
      return toItem(await fetchArticleFromUrl(item.link, signal));
    });
    const seen = new Set<string>();
    const articles: ParsedFeedItem[] = [];
    for (const result of results) {
      if (result.status === "fulfilled" && !seen.has(result.value.link)) {
        seen.add(result.value.link);
        articles.push(result.value);
      }
    }
    if (!articles.length) throw new CrawlError("content", "No linked articles could be read. The source may restrict automated access.");
    return articles;
  } finally {
    clearTimeout(timer);
  }
}
