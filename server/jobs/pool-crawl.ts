import type { Publication } from "@shared/schema";
import { CrawlError, crawlErrorMessage, fetchPublicText, mapCrawlSettled } from "../services/crawlerFetch.js";
import { parseFeedContent } from "../services/universalFeedParser.js";
import { scrapeWebpageArticles } from "../services/webpageScraper";
import { isAllowedByRobots } from "../services/robots";
import { POOL_RETENTION_DAYS, demoteDuplicateBodies, duePublications, fetchPooledBody, pendingPooledBodies, prunePool, recordPublicationCrawl, storePooledArticles } from "../services/articlePool";

/**
 * The shared-index crawl, one cycle every 15 minutes under the scheduler's lock: poll the
 * publications that are due (conditionally, so an unchanged feed costs one small request),
 * store their new stories, fetch a bounded number of article bodies, and prune old rows.
 * Bounded so a cycle finishes well inside its slot on one instance.
 */
export const POOL_CRAWL_LIMITS = Object.freeze({
  publicationsPerCycle: 40, storiesPerPublication: 30, bodiesPerCycle: 60, pollMinutes: 15, maxFailures: 10, cycleMs: 10 * 60_000,
});

export interface PoolCrawlStats { publications: number; failed: number; newStories: number; readable: number; unreadable: number; duplicates: number; pruned: number }

async function crawlPublication(publication: Publication, signal: AbortSignal): Promise<number> {
  if (!(await isAllowedByRobots(publication.feedUrl, signal))) throw new CrawlError("robots", "The publisher's robots.txt disallows this address.");
  let items;
  let etag = publication.etag;
  let lastModified = publication.lastModified;
  if (publication.sourceType === "webpage") {
    items = await scrapeWebpageArticles(publication.feedUrl, signal);
  } else {
    const headers: Record<string, string> = {};
    if (publication.etag) headers["If-None-Match"] = publication.etag;
    if (publication.lastModified) headers["If-Modified-Since"] = publication.lastModified;
    const page = await fetchPublicText(publication.feedUrl, { signal, timeoutMs: 8000, ...(Object.keys(headers).length ? { headers } : {}) });
    if (page.status === 304) {
      await recordPublicationCrawl(publication.id, { status: "unchanged" }, POOL_CRAWL_LIMITS.maxFailures);
      return 0;
    }
    etag = page.headers.get("etag");
    lastModified = page.headers.get("last-modified");
    items = await parseFeedContent(page.text);
    if (!items) throw new CrawlError("feed", "The source did not return a readable RSS, Atom, or JSON feed.");
  }
  const stories = await storePooledArticles(items.slice(0, POOL_CRAWL_LIMITS.storiesPerPublication).map(item => ({
    link: item.link, title: item.title, source: publication.name, content: item.content,
    publishedAt: item.publishedAt ?? item.pubDate, publicationId: publication.id,
  })));
  await recordPublicationCrawl(publication.id, { status: "ok", etag, lastModified }, POOL_CRAWL_LIMITS.maxFailures);
  return stories;
}

/** `only` limits a cycle to given publication ids (and their stories), e.g. to crawl a newly added source at once. */
export async function runPoolCrawlCycle(assertConnected: () => Promise<void> = async () => undefined, now = new Date(), only?: readonly string[]): Promise<PoolCrawlStats> {
  const stats: PoolCrawlStats = { publications: 0, failed: 0, newStories: 0, readable: 0, unreadable: 0, duplicates: 0, pruned: 0 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POOL_CRAWL_LIMITS.cycleMs);
  try {
    const due = await duePublications(POOL_CRAWL_LIMITS.publicationsPerCycle, new Date(now.getTime() - POOL_CRAWL_LIMITS.pollMinutes * 60_000), only);
    stats.publications = due.length;
    await mapCrawlSettled(due, 3, async publication => {
      await assertConnected();
      try {
        stats.newStories += await crawlPublication(publication, controller.signal);
      } catch (error) {
        stats.failed++;
        await recordPublicationCrawl(publication.id, { status: "error", error: crawlErrorMessage(error) }, POOL_CRAWL_LIMITS.maxFailures);
      }
    });
    const pending = await pendingPooledBodies(POOL_CRAWL_LIMITS.bodiesPerCycle, only);
    await mapCrawlSettled(pending, 3, async row => {
      await assertConnected();
      if (await fetchPooledBody(row.canonicalUrl, controller.signal) === "readable") stats.readable++; else stats.unreadable++;
    });
    stats.duplicates = await demoteDuplicateBodies();
    stats.pruned = only ? 0 : await prunePool(POOL_RETENTION_DAYS, 2000);
    console.log(`[pool-crawl] ${stats.publications} publications (${stats.failed} failed), ${stats.newStories} new stories, ${stats.readable} readable + ${stats.unreadable} unreadable bodies, ${stats.duplicates} duplicate bodies demoted, ${stats.pruned} pruned`);
    return stats;
  } finally {
    clearTimeout(timer);
  }
}
