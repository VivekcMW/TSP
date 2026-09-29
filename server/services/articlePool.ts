import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { pooledArticles, publications, type Publication } from "@shared/schema";
import { canonicalHttpUrl } from "@shared/canonical-url";
import { normalizeKeywords, type KeywordInput } from "@shared/profile-preferences";
import type { FetchedArticle } from "./engines/types.js";
import { publicationDate } from "./articleDates";
import { sourceOrigin } from "./inboxDiversity";
import { validateUrlSync } from "./urlValidator";
import { extractArticleFromHtml } from "./urlFetcher";
import { requireReadableHtml } from "./crawlerHtml";
import { harvestOutboundOrigins, noteDiscoveredSites } from "./indexDiscovery";
import { isAllowedByRobots } from "./robots";
import { fetchPublicText, mapCrawlSettled } from "./crawlerFetch.js";

/**
 * The shared article index (docs/superpowers/specs/2026-09-28-shared-article-index-design.md):
 * a catalogue of every feed anyone has picked, and a pool of every story the crawler has seen,
 * keyed by canonical URL, with its body once fetched. Refreshes read candidates here and
 * generation reads text here, so neither depends on a live fetch at the moment of use.
 * Neither table is tenant-scoped.
 */

export const POOL_RETENTION_DAYS = 30;
const BODY_LIMIT = 40_000;
const TERM_LIMIT = 40;
// A page counts as read when the extractor found real prose, not a listing's link text.
const MIN_READABLE_CHARS = 800;

export interface SourceToRegister { name: string; feedUrl: string; sourceType: string; addedVia?: "user-source" | "discovered" }
export interface StoryToStore {
  link: string; title: string; source: string; content?: string | null;
  publishedAt?: string | Date | null; sourceOrigin?: string | null; publicationId?: string | null;
}
export interface PoolProfile {
  keywords?: readonly KeywordInput[] | null;
  companies?: readonly string[] | null;
  influencers?: readonly string[] | null;
}
export interface PooledStory {
  canonicalUrl: string; title: string; source: string; sourceOrigin: string | null; content: string;
  inputKind: "page_body" | "feed_excerpt"; readable: boolean | null; publishedAt: Date | null;
}

/** Some feeds repeat their site address in every link ("https://a.test/https://a.test/story"); keep the inner address. */
export function repairDoubledUrl(value: string): string {
  const match = /^https?:\/\/[^/]+\/(https?:\/\/.+)$/i.exec(value.trim());
  return match ? match[1] : value.trim();
}
const publicCanonical = (value: string) => {
  const canonical = canonicalHttpUrl(repairDoubledUrl(value));
  return canonical && validateUrlSync(canonical) ? canonical : null;
};
const toDate = (value: string | Date | null | undefined) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Page titles and feed titles often carry HTML codes ("Search &amp; Speed"); names are shown as text. */
export function decodeNameEntities(value: string): string {
  return value.replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (match, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16) || 32);
    if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)) || 32);
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[lower] ?? match;
  });
}

/** Adds feeds to the catalogue; a feed already known is left as it is. Returns how many were new. */
export async function registerPublications(sources: readonly SourceToRegister[]): Promise<number> {
  const rows = new Map<string, typeof publications.$inferInsert>();
  for (const source of sources) {
    const feedUrl = publicCanonical(source.feedUrl);
    if (!feedUrl || rows.has(feedUrl)) continue;
    const name = decodeNameEntities(source.name).replace(/\s+/g, " ").trim().slice(0, 200) || new URL(feedUrl).hostname;
    rows.set(feedUrl, { name, feedUrl, siteUrl: new URL(feedUrl).origin, sourceType: source.sourceType === "webpage" ? "webpage" : "feed", addedVia: source.addedVia ?? "user-source" });
  }
  if (!rows.size) return 0;
  const inserted = await db.insert(publications).values([...rows.values()]).onConflictDoNothing({ target: publications.feedUrl }).returning({ id: publications.id });
  return inserted.length;
}

/** Adds stories to the pool; a story already known (by canonical link) is left as it is. Returns how many were new. */
export async function storePooledArticles(stories: readonly StoryToStore[]): Promise<number> {
  const rows = new Map<string, typeof pooledArticles.$inferInsert>();
  for (const story of stories) {
    const canonicalUrl = publicCanonical(story.link);
    if (!canonicalUrl || rows.has(canonicalUrl)) continue;
    const title = story.title.trim().slice(0, 500);
    if (!title) continue;
    rows.set(canonicalUrl, {
      canonicalUrl, title, source: story.source.trim().slice(0, 200) || new URL(canonicalUrl).hostname,
      sourceOrigin: story.sourceOrigin === undefined ? sourceOrigin(canonicalUrl) : story.sourceOrigin,
      content: (story.content ?? "").slice(0, BODY_LIMIT), publishedAt: toDate(story.publishedAt), publicationId: story.publicationId ?? null,
    });
  }
  if (!rows.size) return 0;
  const inserted = await db.insert(pooledArticles).values([...rows.values()]).onConflictDoNothing({ target: pooledArticles.canonicalUrl }).returning({ id: pooledArticles.id });
  return inserted.length;
}

/** Stories from the last `days` days mentioning every word of any of the person's topics, companies or people. */
export async function queryArticlePool(profile: PoolProfile, options: { days: number; limit: number }): Promise<FetchedArticle[]> {
  const terms = new Set<string>();
  for (const group of [profile.keywords ?? [], profile.companies ?? [], profile.influencers ?? []]) {
    for (const keyword of normalizeKeywords(group)) if (keyword.weight > 0 && keyword.keyword.length <= 100) terms.add(keyword.keyword);
  }
  const phrases = [...terms].slice(0, TERM_LIMIT);
  if (!phrases.length) return [];
  const matcher = sql.join(phrases.map(phrase => sql`plainto_tsquery('english', ${phrase})`), sql` || `);
  const cutoff = new Date(Date.now() - options.days * 86_400_000);
  const rows = await db.select().from(pooledArticles)
    .where(and(gte(pooledArticles.publishedAt, cutoff), sql`search @@ (${matcher})`))
    .orderBy(desc(pooledArticles.publishedAt)).limit(Math.max(1, Math.min(options.limit, 500)));
  return rows.map(row => {
    const date = publicationDate(row.publishedAt?.toISOString(), "rss-pubDate");
    return {
      title: row.title, link: row.canonicalUrl, source: row.source, sourceOrigin: row.sourceOrigin,
      content: row.content, categories: [], pubDate: date.publishedAt, publishedAt: date.publishedAt, publicationDate: date,
      inputKind: row.readable && row.inputKind === "page_body" ? "page_body" : "feed_excerpt",
    };
  });
}

export async function findPooledArticle(url: string): Promise<PooledStory | null> {
  const canonicalUrl = canonicalHttpUrl(url);
  if (!canonicalUrl) return null;
  const [row] = await db.select().from(pooledArticles).where(eq(pooledArticles.canonicalUrl, canonicalUrl)).limit(1);
  if (!row) return null;
  return { canonicalUrl: row.canonicalUrl, title: row.title, source: row.source, sourceOrigin: row.sourceOrigin, content: row.content,
    inputKind: row.inputKind === "page_body" ? "page_body" : "feed_excerpt", readable: row.readable, publishedAt: row.publishedAt };
}

/** Of these links, the ones whose page the crawler already found unreadable (canonical form). */
export async function knownUnreadableLinks(urls: readonly string[]): Promise<string[]> {
  const canonical = [...new Set(urls.map(url => canonicalHttpUrl(url)).filter((url): url is string => Boolean(url)))].slice(0, 600);
  if (!canonical.length) return [];
  const rows = await db.select({ canonicalUrl: pooledArticles.canonicalUrl }).from(pooledArticles)
    .where(and(eq(pooledArticles.readable, false), inArray(pooledArticles.canonicalUrl, canonical)));
  return rows.map(row => row.canonicalUrl);
}

/** Records the outcome of fetching a story's page. A readable body replaces the feed excerpt. */
export async function markPooledBody(url: string, outcome: { readable: boolean; content?: string; title?: string }): Promise<void> {
  const canonicalUrl = canonicalHttpUrl(url);
  if (!canonicalUrl) return;
  const body = outcome.readable && outcome.content ? outcome.content.slice(0, BODY_LIMIT) : undefined;
  await db.update(pooledArticles).set({
    readable: outcome.readable, bodyFetchedAt: new Date(),
    ...(body ? { content: body, inputKind: "page_body" } : {}),
    ...(outcome.title?.trim() ? { title: outcome.title.trim().slice(0, 500) } : {}),
  }).where(eq(pooledArticles.canonicalUrl, canonicalUrl));
}

/** Stories whose page hasn't been fetched yet, newest first; `only` narrows to given publications. */
export async function pendingPooledBodies(limit: number, only?: readonly string[]): Promise<Array<{ id: string; canonicalUrl: string }>> {
  return db.select({ id: pooledArticles.id, canonicalUrl: pooledArticles.canonicalUrl }).from(pooledArticles)
    .where(and(isNull(pooledArticles.readable), ...(only ? [inArray(pooledArticles.publicationId, only.length ? [...only] : ["-"])] : [])))
    .orderBy(desc(pooledArticles.createdAt)).limit(Math.max(1, Math.min(limit, 500)));
}

/** Fetches one story's page, honouring robots.txt, and records whether it held readable prose. */
export async function fetchPooledBody(url: string, signal?: AbortSignal): Promise<"readable" | "unreadable"> {
  let outcome: { readable: boolean; content?: string } = { readable: false };
  try {
    if (await isAllowedByRobots(url, signal)) {
      const page = await fetchPublicText(url, { signal });
      requireReadableHtml(page);
      const article = extractArticleFromHtml(page.text, page.url);
      // Other publishers this story links to are candidates for the catalogue.
      await noteDiscoveredSites(harvestOutboundOrigins(page.text, page.url), "link").catch(() => undefined);
      // A redirect to the site's front page, or metadata alone, is not the story. The feed's
      // headline is kept: a page <title> is often the site's name, not the article's.
      const landedOnFrontPage = new URL(article.url).pathname === "/";
      const prose = article.contentMetadata?.extractionMethod !== "metadata";
      if (article.content.length >= MIN_READABLE_CHARS && prose && !landedOnFrontPage) outcome = { readable: true, content: article.content };
    }
  } catch {
    // Paywalls, blocks, timeouts and challenge pages all mean "not readable for now".
  }
  await markPooledBody(url, outcome);
  return outcome.readable ? "readable" : "unreadable";
}

/** Best-effort: makes sure these stories are in the pool and fetches the bodies not fetched yet, a few at a time. */
export async function prefetchPooledBodies(stories: readonly StoryToStore[], options: { limit: number; signal?: AbortSignal }): Promise<number> {
  await storePooledArticles(stories);
  const wanted = stories.map(story => publicCanonical(story.link)).filter((url): url is string => Boolean(url)).slice(0, options.limit);
  let fetched = 0;
  await mapCrawlSettled(wanted, 3, async url => {
    const known = await findPooledArticle(url);
    if (!known || known.readable !== null) return;
    await fetchPooledBody(url, options.signal);
    fetched++;
  });
  return fetched;
}

/**
 * A site's boilerplate (a "trending" block, a subscription pitch) can be extracted under many
 * headlines. When several stories from one site share a body, only the first stays readable.
 * Returns how many were demoted.
 */
export async function demoteDuplicateBodies(): Promise<number> {
  const result = await db.execute(sql`update ${pooledArticles} a set readable = false
    where a.readable and a.body_hash is not null and exists (
      select 1 from ${pooledArticles} b where b.readable and b.source_origin = a.source_origin and b.body_hash = a.body_hash
        and (b.created_at, b.canonical_url) < (a.created_at, a.canonical_url))`);
  return result.rowCount ?? 0;
}

/** Deletes stories older than the retention window, `batch` at a time. Returns how many were deleted. */
export async function prunePool(days: number, batch: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const result = await db.execute(sql`delete from ${pooledArticles} where id in (
    select id from ${pooledArticles} where coalesce(published_at, created_at) < ${cutoff} limit ${Math.max(1, Math.min(batch, 5000))})`);
  return result.rowCount ?? 0;
}

/** Active publications not polled since `olderThan`, never-polled first; `only` narrows to given ids. */
export async function duePublications(limit: number, olderThan: Date, only?: readonly string[]): Promise<Publication[]> {
  return db.select().from(publications)
    .where(and(eq(publications.isActive, true), or(isNull(publications.lastCrawledAt), lt(publications.lastCrawledAt, olderThan)),
      ...(only ? [inArray(publications.id, only.length ? [...only] : ["-"])] : [])))
    .orderBy(sql`${publications.lastCrawledAt} asc nulls first`).limit(Math.max(1, Math.min(limit, 500)));
}

export interface CrawlOutcome { status: "ok" | "unchanged" | "error"; error?: string | null; etag?: string | null; lastModified?: string | null; hubUrl?: string | null }

/** Records one poll. After `maxFailures` errors in a row the publication is switched off. */
export async function recordPublicationCrawl(id: string, outcome: CrawlOutcome, maxFailures: number): Promise<void> {
  const failed = outcome.status === "error";
  await db.update(publications).set({
    lastCrawledAt: new Date(), updatedAt: new Date(), lastCrawlStatus: outcome.status,
    lastCrawlError: failed ? (outcome.error ?? "Unknown error").slice(0, 500) : null,
    consecutiveFailures: failed ? sql`${publications.consecutiveFailures} + 1` : 0,
    isActive: failed ? sql`${publications.consecutiveFailures} + 1 < ${maxFailures}` : true,
    ...(outcome.etag !== undefined ? { etag: outcome.etag } : {}),
    ...(outcome.lastModified !== undefined ? { lastModified: outcome.lastModified } : {}),
    ...(outcome.hubUrl !== undefined ? { hubUrl: outcome.hubUrl } : {}),
  }).where(eq(publications.id, id));
}

export async function publicationById(id: string): Promise<Publication | null> {
  const [row] = await db.select().from(publications).where(eq(publications.id, id)).limit(1);
  return row ?? null;
}

/** Publications with a hub whose lease is missing, expiring within a day, or whose request got no verification in an hour. */
export async function websubDuePublications(limit: number, now = new Date()): Promise<Publication[]> {
  const soon = new Date(now.getTime() + 86_400_000);
  const stale = new Date(now.getTime() - 3_600_000);
  return db.select().from(publications)
    .where(and(eq(publications.isActive, true), sql`${publications.hubUrl} is not null`,
      or(isNull(publications.websubLeaseExpiresAt), lt(publications.websubLeaseExpiresAt, soon)),
      or(isNull(publications.websubSubscribedAt), lt(publications.websubSubscribedAt, stale))))
    .orderBy(sql`${publications.websubLeaseExpiresAt} asc nulls first`).limit(Math.max(1, Math.min(limit, 200)));
}

export async function recordWebSubRequest(id: string, secret: string): Promise<void> {
  await db.update(publications).set({ websubSecret: secret, websubSubscribedAt: new Date(), updatedAt: new Date() }).where(eq(publications.id, id));
}

/** The hub's verification: true only when the topic is this publication's feed and it has a hub. */
export async function confirmWebSubLease(id: string, topic: string, leaseSeconds: number): Promise<boolean> {
  const rows = await db.update(publications).set({ websubLeaseExpiresAt: new Date(Date.now() + Math.max(60, Math.min(leaseSeconds, 90 * 86_400)) * 1000), updatedAt: new Date() })
    .where(and(eq(publications.id, id), eq(publications.feedUrl, topic), sql`${publications.hubUrl} is not null`)).returning({ id: publications.id });
  return rows.length > 0;
}

export interface IndexHealth {
  publications: { active: number; inactive: number; discovered: number; withHub: number; pushing: number; failing: number };
  discovered: { pending: number; registered: number; noFeed: number };
  pool: { stories: number; readable: number; unreadable: number; pending: number; last24h: number };
  watchTerms: number;
}

/** Counts for the admin view of the shared index. */
export async function indexHealth(): Promise<IndexHealth> {
  const [[p], [d], [a], [w]] = await Promise.all([
    db.execute(sql`select count(*) filter (where is_active) as active, count(*) filter (where not is_active) as inactive,
      count(*) filter (where added_via = 'discovered') as discovered, count(*) filter (where hub_url is not null) as with_hub,
      count(*) filter (where websub_lease_expires_at > now()) as pushing, count(*) filter (where consecutive_failures >= 3) as failing from ${publications}`).then(r => r.rows as Array<Record<string, string>>),
    db.execute(sql`select count(*) filter (where status = 'pending') as pending, count(*) filter (where status = 'registered') as registered,
      count(*) filter (where status = 'no-feed') as no_feed from discovered_sites`).then(r => r.rows as Array<Record<string, string>>),
    db.execute(sql`select count(*) as stories, count(*) filter (where readable) as readable, count(*) filter (where readable is false) as unreadable,
      count(*) filter (where readable is null) as pending, count(*) filter (where created_at > now() - interval '24 hours') as last24h from ${pooledArticles}`).then(r => r.rows as Array<Record<string, string>>),
    db.execute(sql`select count(*) as terms from watch_terms`).then(r => r.rows as Array<Record<string, string>>),
  ]);
  const n = (value: string | undefined) => Number(value ?? 0);
  return {
    publications: { active: n(p?.active), inactive: n(p?.inactive), discovered: n(p?.discovered), withHub: n(p?.with_hub), pushing: n(p?.pushing), failing: n(p?.failing) },
    discovered: { pending: n(d?.pending), registered: n(d?.registered), noFeed: n(d?.no_feed) },
    pool: { stories: n(a?.stories), readable: n(a?.readable), unreadable: n(a?.unreadable), pending: n(a?.pending), last24h: n(a?.last24h) },
    watchTerms: n(w?.terms),
  };
}
