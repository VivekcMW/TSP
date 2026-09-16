import { AsyncLocalStorage } from "node:async_hooks";
import { CrawlError, crawlErrorMessage, fetchPublicText, type CrawlPage, type CrawlBudget } from "./crawlerFetch.js";
import { isSingleArticle, requireReadableHtml } from "./crawlerHtml.js";
import { extractArticleFromHtml } from "./urlFetcher.js";
import { extractListingLinks } from "./webpageScraper.js";
import { parseFeedContent } from "./universalFeedParser.js";

/**
 * Live, multi-signal feed discovery for any site a user adds — replaces the
 * old static ~80-entry publication dictionary. Given an explicit URL, this
 * combines several independent signals rather than one guess:
 *   1. the input itself, if it's already a working feed
 *   2. every <link rel="alternate"> the homepage (or its blog/news
 *      subsection, if found) actually declares — RSS, Atom, or JSON Feed
 *   3. any <a href> on that page that looks like a feed link (a site's own
 *      "Subscribe"/"RSS" link, wherever it points)
 *   4. a broad set of platform-aware conventional paths (WordPress, Ghost,
 *      Substack, Blogger, Tumblr, Squarespace, Medium, ...)
 * All candidates are validated concurrently so checking many of them stays
 * fast, and validation happens against real fetched content (not a HEAD
 * request), so a URL that merely returns 200 but isn't a feed is rejected.
 */

const FETCH_TIMEOUT_MS = 4000;
const MAX_CANDIDATES = 12;
const discoveryContext = new AsyncLocalStorage<{ signal: AbortSignal; pages: Map<string, Promise<CrawlPage>>; budget: CrawlBudget }>();

const PLATFORM_FEED_PATHS = [
  // WordPress (self-hosted and most page builders that bolt a blog onto one)
  "/feed", "/?feed=rss2", "/blog/feed", "/blog/?feed=rss2",
  // Generic / spec-default
  "/rss", "/rss.xml", "/feed.xml", "/atom.xml", "/index.xml",
  // Blogger / Blogspot
  "/feeds/posts/default",
  // Squarespace
  "/blog?format=rss",
  "/news/feed",
];

export interface DiscoveredFeed {
  name: string;
  feedUrl: string;
  /** "feed" when feedUrl is a real RSS/Atom/JSON feed, "webpage" when it's a plain page scraped directly (no feed exists). */
  sourceType: "feed" | "webpage";
}
export interface FeedDiscoveryError {
  error: string;
}

interface FetchedPage {
  finalUrl: string;
  html: string;
}

/** Request-scoped memoization includes failures. No retries that amplify host throttling. */
function fetchWithGuard(url: string): Promise<CrawlPage> {
  const context = discoveryContext.getStore();
  if (!context) throw new Error("Missing discovery context");
  context.signal.throwIfAborted();
  const normalized = new URL(url);
  normalized.hash = "";
  const key = normalized.href;
  const cached = context.pages.get(key);
  if (cached) return cached;
  if (context.pages.size >= 16) throw new CrawlError("budget", "Feed discovery reached its probe limit. Try a direct feed URL.");
  const result = fetchPublicText(key, { signal: context.signal, timeoutMs: FETCH_TIMEOUT_MS, budget: context.budget });
  context.pages.set(key, result);
  return result;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    return (await fetchWithGuard(url)).text;
  } catch {
    return null;
  }
}

async function fetchPage(url: string): Promise<FetchedPage | null> {
  try {
    const res = await fetchWithGuard(url);
    requireReadableHtml(res);
    return { finalUrl: res.url, html: res.text };
  } catch {
    return null;
  }
}

async function tryParse(url: string): Promise<boolean> {
  const text = await fetchText(url);
  if (!text) return false;
  const items = await parseFeedContent(text);
  return Boolean(items && items.length > 0);
}

function bareHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Schemes we can never crawl (not fetchable web pages) - rejected outright instead of being mis-guessed as a domain. */
const REJECTED_SCHEME_RE = /^(ftp|ftps|mailto|javascript|data|file|tel|sms|ws|wss|chrome|about):/i;

export function normalizeToUrl(input: string): string | null {
  const trimmed = input.trim().replace(/^\/\//, "https://");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (REJECTED_SCHEME_RE.test(trimmed)) return null;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return null;
}

/** Platforms that never publish a public feed - checked up front so these fail fast with an honest reason instead of burning time probing dead-end paths. */
const NO_RSS_PLATFORMS: Record<string, string> = {
  "twitter.com": "X (Twitter)",
  "x.com": "X (Twitter)",
  "instagram.com": "Instagram",
  "facebook.com": "Facebook",
  "linkedin.com": "LinkedIn",
  "tiktok.com": "TikTok",
  "threads.net": "Threads",
  "snapchat.com": "Snapchat",
};

function matchNoRssPlatform(baseUrl: string): string | null {
  const host = bareHost(baseUrl);
  return host ? (NO_RSS_PLATFORMS[host] ?? null) : null;
}

const FEED_LINK_TYPE_RE = /<link\b[^>]{0,400}\brel=["']alternate["'][^>]{0,400}>/gi;
const FEED_TYPE_RANK: Record<string, number> = {
  "application/rss+xml": 0,
  "application/atom+xml": 1,
  "application/feed+json": 2,
  "application/json": 3,
};

/** Every <link rel="alternate" type="feed-ish"> the page declares, ranked RSS > Atom > JSON Feed (most sites' primary feed is RSS). */
function extractLinkFeedCandidates(html: string, baseUrl: string): string[] {
  const found: Array<{ url: string; rank: number }> = [];
  for (const tag of html.match(FEED_LINK_TYPE_RE) ?? []) {
    const typeMatch = /type=["']([^"']+)["']/i.exec(tag);
    const type = typeMatch?.[1]?.toLowerCase();
    if (!type || !(type in FEED_TYPE_RANK)) continue;
    const hrefMatch = /href=["']([^"']+)["']/i.exec(tag);
    if (!hrefMatch) continue;
    try {
      found.push({ url: new URL(hrefMatch[1], baseUrl).toString(), rank: FEED_TYPE_RANK[type] });
    } catch {
      // ignore malformed href
    }
  }
  const ranked = [...found].sort((a, b) => a.rank - b.rank);
  return ranked.map((f) => f.url);
}

const FEED_LIKE_HREF_RE = /rss|atom|\/feed\b|feed\.xml|feed=rss|\.rss\b/i;

/** A site's own "Subscribe"/"RSS" link, wherever the theme happens to put it — catches feeds that don't declare a <link> tag at all. */
function extractAnchorFeedCandidates(html: string, baseUrl: string): string[] {
  const found: string[] = [];
  const anchorRe = /<a\b[^>]{0,300}\bhref=["']([^"']+)["'][^>]{0,300}>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) !== null) {
    const href = match[1];
    if (!FEED_LIKE_HREF_RE.test(href)) continue;
    try {
      found.push(new URL(href, baseUrl).toString());
    } catch {
      // ignore malformed href
    }
  }
  return found;
}

const SUBSECTION_SLUGS = new Set(["blog", "news", "insights", "articles", "press", "resources", "stories"]);

/** A plausible content-hub page linked from the homepage nav (e.g. "/blog") — many sites declare their feed only on that subsection's pages, not the root. */
function extractSubsectionHubUrl(html: string, baseUrl: string): string | null {
  const anchorRe = /<a\b[^>]{0,300}\bhref=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) !== null) {
    try {
      const resolved = new URL(match[1], baseUrl);
      const segments = resolved.pathname.split("/").filter(Boolean);
      if (resolved.origin === new URL(baseUrl).origin && segments.length === 1 && SUBSECTION_SLUGS.has(segments[0].toLowerCase())) {
        return resolved.toString();
      }
    } catch {
      // ignore malformed href
    }
  }
  return null;
}

/**
 * Well-known platforms whose pages are JS-rendered SPAs with no discoverable
 * <link>/<a> feed signal, but that expose a real feed through a documented
 * convention instead. Checked before generic discovery; returns null (not an
 * error) for anything that doesn't match so the caller falls through to the
 * generic path.
 */
async function resolveKnownPlatform(baseUrl: string): Promise<DiscoveredFeed | null> {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m)\./i, "").toLowerCase();

  if (host === "youtube.com") return resolveYouTube(url);
  if (host === "reddit.com" || host === "old.reddit.com") return resolveReddit(url);
  if (host === "medium.com") return resolveMedium(url);
  if (host === "github.com") return resolveGitHub(url);
  if (host === "podcasts.apple.com") return resolveApplePodcasts(url);
  return null;
}

async function resolveYouTube(url: URL): Promise<DiscoveredFeed | null> {
  const segments = url.pathname.split("/").filter(Boolean);
  const buildFeed = async (channelId: string, name: string): Promise<DiscoveredFeed | null> => {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
    return (await tryParse(feedUrl)) ? { name, feedUrl, sourceType: "feed" } : null;
  };

  if (segments[0] === "channel" && segments[1]) return buildFeed(segments[1], `YouTube: ${segments[1]}`);

  const playlistId = url.searchParams.get("list");
  if (segments[0] === "playlist" && playlistId) {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`;
    return (await tryParse(feedUrl)) ? { name: "YouTube playlist", feedUrl, sourceType: "feed" } : null;
  }

  // Handle (@name), and the legacy /c/ and /user/ aliases all need the real
  // channel id scraped from the rendered page - YouTube never puts it in the URL.
  const isAlias = segments[0]?.startsWith("@") || segments[0] === "c" || segments[0] === "user";
  if (isAlias) {
    const page = await fetchPage(url.toString());
    if (!page) return null;
    const channelId =
      /"channelId":"(UC[0-9A-Za-z_-]{10,})"/.exec(page.html)?.[1] ??
      /youtube\.com\/channel\/(UC[0-9A-Za-z_-]{10,})/.exec(page.html)?.[1];
    return channelId ? buildFeed(channelId, `YouTube: ${segments[0]}`) : null;
  }
  return null;
}

async function resolveReddit(url: URL): Promise<DiscoveredFeed | null> {
  const segments = url.pathname.split("/").filter(Boolean);
  let feedUrl: string | null = null;
  let name: string | null = null;
  if (segments[0] === "r" && segments[1]) {
    feedUrl = `https://www.reddit.com/r/${segments[1]}/.rss`;
    name = `r/${segments[1]}`;
  } else if ((segments[0] === "user" || segments[0] === "u") && segments[1]) {
    feedUrl = `https://www.reddit.com/user/${segments[1]}/.rss`;
    name = `u/${segments[1]}`;
  }
  if (!feedUrl || !name) return null;
  return (await tryParse(feedUrl)) ? { name, feedUrl, sourceType: "feed" } : null;
}

async function resolveMedium(url: URL): Promise<DiscoveredFeed | null> {
  const segments = url.pathname.split("/").filter(Boolean);
  const first = segments[0];
  if (!first) return null;
  let feedUrl: string | null = null;
  let name: string = first;
  if (first !== "tag" && segments.length !== 1) return null;
  if (first.startsWith("@")) {
    feedUrl = `https://medium.com/feed/${first}`;
  } else if (first === "tag" && segments[1]) {
    feedUrl = `https://medium.com/feed/tag/${segments[1]}`;
    name = `Medium: ${segments[1]}`;
  } else if (!["m", "search", "about", "topic", "new-story", "me"].includes(first)) {
    feedUrl = `https://medium.com/feed/${first}`;
  }
  if (!feedUrl) return null;
  return (await tryParse(feedUrl)) ? { name, feedUrl, sourceType: "feed" } : null;
}

async function resolveGitHub(url: URL): Promise<DiscoveredFeed | null> {
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) return null;
  const [owner, repo] = segments;
  for (const feedUrl of [
    `https://github.com/${owner}/${repo}/releases.atom`,
    `https://github.com/${owner}/${repo}/commits.atom`,
  ]) {
    if (await tryParse(feedUrl)) return { name: `${owner}/${repo}`, feedUrl, sourceType: "feed" };
  }
  return null;
}

/** Apple's own public, unauthenticated lookup API resolves a podcast id straight to its real RSS feed URL - no guessing needed. */
async function resolveApplePodcasts(url: URL): Promise<DiscoveredFeed | null> {
  const id = /\/id(\d+)/.exec(url.pathname)?.[1];
  if (!id) return null;
  try {
    const res = await fetchWithGuard(`https://itunes.apple.com/lookup?id=${id}`);
    const data: any = JSON.parse(res.text);
    const feedUrl = data?.results?.[0]?.feedUrl;
    const name = data?.results?.[0]?.collectionName;
    if (typeof feedUrl !== "string") return null;
    return (await tryParse(feedUrl)) ? { name: typeof name === "string" ? name : "Podcast", feedUrl, sourceType: "feed" } : null;
  } catch {
    return null;
  }
}

/** First candidate (in priority order) that actually parses as a feed, checked concurrently so trying many candidates doesn't add up latency-wise. */
async function firstValidCandidate(candidates: string[]): Promise<string | null> {
  const unique = Array.from(new Set(candidates)).slice(0, MAX_CANDIDATES);
  // Priority-ordered pairs: stop probing as soon as a valid feed is found.
  for (let i = 0; i < unique.length; i += 2) {
    discoveryContext.getStore()!.signal.throwIfAborted();
    const batch = unique.slice(i, i + 2);
    const results = await Promise.all(batch.map(tryParse));
    const index = results.indexOf(true);
    if (index !== -1) return (await fetchWithGuard(batch[index])).url;
  }
  return null;
}

async function findFeedOnDomain(baseUrl: string): Promise<string | null> {
  const homepage = await fetchPage(baseUrl);
  // Some sites only redirect the root path to their canonical host (e.g.
  // bare domain -> www), not deeper paths - resolving conventional paths
  // against the ALREADY-redirected homepage URL avoids silently probing a
  // non-canonical host where those paths 404 even though the real feed
  // exists on the canonical one.
  const canonicalBaseUrl = homepage?.finalUrl ?? baseUrl;
  const candidates: string[] = [];

  if (homepage) {
    candidates.push(...extractLinkFeedCandidates(homepage.html, homepage.finalUrl), ...extractAnchorFeedCandidates(homepage.html, homepage.finalUrl));

    // No feed declared on the homepage itself? Check its most likely content
    // subsection (e.g. "/blog") the same way before falling back to guesses.
    if (candidates.length === 0) {
      const hubUrl = extractSubsectionHubUrl(homepage.html, homepage.finalUrl);
      if (hubUrl) {
        const hubPage = await fetchPage(hubUrl);
        if (hubPage) {
          candidates.push(...extractLinkFeedCandidates(hubPage.html, hubPage.finalUrl), ...extractAnchorFeedCandidates(hubPage.html, hubPage.finalUrl));
        }
      }
    }

    // A deep link (e.g. one specific article's permalink, not the homepage)
    // may not repeat the site's feed <link> tag on every page - re-check the
    // bare site root too, so pasting any article URL still resolves to the
    // outlet's feed rather than only working for homepage URLs.
    if (candidates.length === 0) {
      let rootUrl: string | null = null;
      try {
        const origin = `${new URL(homepage.finalUrl).origin}/`;
        if (origin !== homepage.finalUrl) rootUrl = origin;
      } catch {
        rootUrl = null;
      }
      if (rootUrl) {
        const rootPage = await fetchPage(rootUrl);
        if (rootPage) {
          candidates.push(...extractLinkFeedCandidates(rootPage.html, rootPage.finalUrl), ...extractAnchorFeedCandidates(rootPage.html, rootPage.finalUrl));
        }
      }
    }
  }

  for (const path of PLATFORM_FEED_PATHS) {
    try {
      candidates.push(new URL(path, canonicalBaseUrl).toString());
    } catch {
      // ignore malformed combination
    }
  }

  return firstValidCandidate(candidates);
}

/**
 * Resolve explicit URLs only. A reachable guessed domain proves neither
 * publication identity nor user consent, so bare names are never crawled.
 */
export async function discoverFeed(input: string, parentSignal?: AbortSignal): Promise<DiscoveredFeed | FeedDiscoveryError> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
  try {
    return await discoveryContext.run({ signal, pages: new Map(), budget: { requests: 24, bytes: 4 * 1024 * 1024 } }, () => discoverExplicitFeed(input));
  } catch (error) {
    return { error: signal.aborted ? "Discovery exceeded its time budget. Try a direct feed URL or retry later." : crawlErrorMessage(error) };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function discoverExplicitFeed(input: string): Promise<DiscoveredFeed | FeedDiscoveryError> {
  const name = input.trim();
  const explicitBaseUrl = normalizeToUrl(name);
  if (!explicitBaseUrl) return { error: "Enter the publication's explicit website or feed URL. We don't guess domains from names." };
  const noRssPlatform = matchNoRssPlatform(explicitBaseUrl);
  if (noRssPlatform) {
    return { error: `${noRssPlatform} doesn't publish a public feed, so this can't be auto-discovered. Try a different source.` };
  }

  const platformResult = await resolveKnownPlatform(explicitBaseUrl);
  if (platformResult) return { ...platformResult, feedUrl: (await fetchWithGuard(platformResult.feedUrl)).url };

  // Initial errors are fatal: do not turn an inaccessible URL into an unrelated source.
  const page = await fetchWithGuard(explicitBaseUrl);
  const items = await parseFeedContent(page.text);
  if (items) return { name: bareHost(page.url) || name, feedUrl: page.url, sourceType: "feed" };
  requireReadableHtml(page);
  const webpageName = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(page.text)?.[1]?.trim() || bareHost(page.url) || name;
  const webpage: DiscoveredFeed = { name: webpageName, feedUrl: page.url, sourceType: "webpage" };
  if (isSingleArticle(page.text)) {
    extractArticleFromHtml(page.text, page.url);
    return webpage;
  }
  const feedUrl = await findFeedOnDomain(explicitBaseUrl);
  if (feedUrl) return { name: bareHost(feedUrl) || name, feedUrl, sourceType: "feed" };
  // Link labels alone do not prove a crawlable listing (login/account menus
  // often look like one). Validate at least one bounded, guarded child body.
  const links = extractListingLinks(page.text, page.url);
  if (links.length < 3) {
    extractArticleFromHtml(page.text, page.url);
  } else {
    for (const link of links.slice(0, 3)) {
      try {
        const child = await fetchWithGuard(link.link);
        requireReadableHtml(child);
        extractArticleFromHtml(child.text, child.url);
        return webpage;
      } catch {
        discoveryContext.getStore()!.signal.throwIfAborted();
      }
    }
    throw new CrawlError("quality", "No readable public articles were found in this listing. Its links may be navigation or require login.");
  }
  return webpage;
}

