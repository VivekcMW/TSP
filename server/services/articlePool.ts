import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { pooledArticles, publications, type Publication } from "@shared/schema";
import { canonicalHttpUrl } from "@shared/canonical-url";
import { normalizeKeywords, type KeywordInput } from "@shared/profile-preferences";
import type { FetchedArticle } from "./engines/types.js";
import { publicationDate } from "./articleDates";
import { sourceOrigin } from "./inboxDiversity";
import { validateUrlSync } from "./urlValidator";
import { fetchArticleFromUrl } from "./urlFetcher";
import { isAllowedByRobots } from "./robots";
import { mapCrawlSettled } from "./crawlerFetch.js";

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

export interface SourceToRegister { name: string; feedUrl: string; sourceType: string }
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

/** Adds feeds to the catalogue; a feed already known is left as it is. Returns how many were new. */
export async function registerPublications(sources: readonly SourceToRegister[]): Promise<number> {
  const rows = new Map<string, typeof publications.$inferInsert>();
  for (const source of sources) {
    const feedUrl = publicCanonical(source.feedUrl);
    if (!feedUrl || rows.has(feedUrl)) continue;
    const name = source.name.trim().slice(0, 200) || new URL(feedUrl).hostname;
    rows.set(feedUrl, { name, feedUrl, siteUrl: new URL(feedUrl).origin, sourceType: source.sourceType === "webpage" ? "webpage" : "feed" });
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
      const article = await fetchArticleFromUrl(url, signal);
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

export interface CrawlOutcome { status: "ok" | "unchanged" | "error"; error?: string | null; etag?: string | null; lastModified?: string | null }

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
  }).where(eq(publications.id, id));
}
