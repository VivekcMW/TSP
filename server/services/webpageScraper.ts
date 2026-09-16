import { assertPublicHttpUrl } from "./urlValidator.js";
import type { ParsedFeedItem } from "./universalFeedParser.js";
import { stripHtml } from "./universalFeedParser.js";

/**
 * Fallback content source for any public webpage that has no discoverable
 * RSS/Atom/JSON feed (feedDiscovery.ts already tried everything realistic
 * before handing off here). Two modes, chosen automatically:
 *
 *   1. Listing mode — the page links to several distinct sub-pages that look
 *      like content (e.g. a blog index, or a help-center collection listing
 *      its articles). Each linked page becomes its own "article" (title =
 *      link text, no body content since we don't fetch every linked page).
 *   2. Single-page mode — too few listing-like links were found, so the page
 *      itself is treated as one article, using its <title> and meta
 *      description as the headline/summary.
 *
 * Re-fetched on every refresh; dedup against existing inbox items happens
 * downstream by URL, same as real feeds.
 */

const FETCH_TIMEOUT_MS = 6000;
const MIN_LISTING_LINKS = 3;
const MAX_ARTICLES = 15;
const MIN_LINK_TEXT_LENGTH = 12;

async function fetchPage(url: string): Promise<{ finalUrl: string; html: string } | null> {
  const guard = await assertPublicHttpUrl(url);
  if (!guard.ok) return null;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "TheSocialPundit/1.0 (Webpage Reader)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return null;
    return { finalUrl: res.url, html: await res.text() };
  } catch {
    return null;
  }
}

function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(html);
  return match ? stripHtml(match[1]).trim() || null : null;
}

function extractMetaContent(html: string, names: string[]): string | null {
  for (const name of names) {
    const re = new RegExp(
      String.raw`<meta\b[^>]{0,300}\b(?:name|property)=["']${name}["'][^>]{0,300}\bcontent=["']([^"']{1,500})["']`,
      "i",
    );
    const match = re.exec(html);
    if (match) return stripHtml(match[1]).trim() || null;
  }
  return null;
}

function bareHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return url;
  }
}

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
  if (bareHost(resolved.toString()) !== pageHost) return null;
  if (JUNK_PATH_RE.test(resolved.pathname)) return null;
  if (resolved.toString() === baseUrl) return null;

  return { title: text, link: resolved.toString() };
}

/** Same-origin anchors with enough visible text to plausibly be content, not nav/footer chrome. */
function extractListingLinks(html: string, baseUrl: string): Array<{ title: string; link: string }> {
  const pageHost = bareHost(baseUrl);
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
 * Never throws — returns an empty array if the page can't be fetched, same
 * failure contract as a feed fetch failing.
 */
export async function scrapeWebpageArticles(url: string): Promise<ParsedFeedItem[]> {
  const page = await fetchPage(url);
  if (!page) return [];

  const listingLinks = extractListingLinks(page.html, page.finalUrl);
  const now = new Date().toISOString();

  if (listingLinks.length >= MIN_LISTING_LINKS) {
    return listingLinks.map((item) => ({
      title: item.title,
      link: item.link,
      pubDate: now,
      content: "",
      categories: [],
    }));
  }

  const title = extractTitle(page.html) || bareHost(page.finalUrl);
  const description = extractMetaContent(page.html, ["og:description", "description", "twitter:description"]) || "";
  return [{ title, link: page.finalUrl, pubDate: now, content: description, categories: [] }];
}
