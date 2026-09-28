import type { Publication } from "@shared/schema";
import { CrawlError, crawlErrorMessage, fetchPublicText, mapCrawlSettled } from "../services/crawlerFetch.js";
import { parseFeedContent } from "../services/universalFeedParser.js";
import { scrapeWebpageArticles } from "../services/webpageScraper";
import { isAllowedByRobots } from "../services/robots";
import { probeDiscoveredSites } from "../services/indexDiscovery";
import { ingestLatestGdelt } from "../services/gdelt";
import { hubLink, renewWebSubLeases } from "../services/websub";
import { POOL_RETENTION_DAYS, demoteDuplicateBodies, duePublications, fetchPooledBody, pendingPooledBodies, prunePool, recordPublicationCrawl, storePooledArticles } from "../services/articlePool";

/**
 * The shared-index crawl, one cycle every 15 minutes under the scheduler's lock: poll the
 * publications that are due (conditionally, so an unchanged feed costs one small request),
 * store their new stories, fetch a bounded number of article bodies, and prune old rows.
 * Bounded so a cycle finishes well inside its slot on one instance.
 */
export const POOL_CRAWL_LIMITS = Object.freeze({
  publicationsPerCycle: 40, storiesPerPublication: 30, bodiesPerCycle: 60, sitesPerCycle: 5, leasesPerCycle: 20, pollMinutes: 15, maxFailures: 10, cycleMs: 10 * 60_000,
});

export interface PoolCrawlStats { publications: number; failed: number; newStories: number; readable: number; unreadable: number; duplicates: number; probed: number; registered: number; gdeltStories: number; gdeltSites: number; leases: number; pruned: number }

/** The last completed cycle, for the admin view (one instance in production). */
export let lastPoolCrawl: { at: Date; stats: PoolCrawlStats } | null = null;

async function crawlPublication(publication: Publication, signal: AbortSignal): Promise<number> {
  if (!(await isAllowedByRobots(publication.feedUrl, signal))) throw new CrawlError("robots", "The publisher's robots.txt disallows this address.");
  let items;
  let etag = publication.etag;
  let lastModified = publication.lastModified;
  let hubUrl: string | null | undefined;
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
    hubUrl = hubLink(page.text);
    items = await parseFeedContent(page.text);
    if (!items) throw new CrawlError("feed", "The source did not return a readable RSS, Atom, or JSON feed.");
  }
  const stories = await storePooledArticles(items.slice(0, POOL_CRAWL_LIMITS.storiesPerPublication).map(item => ({
    link: item.link, title: item.title, source: publication.name, content: item.content,
    publishedAt: item.publishedAt ?? item.pubDate, publicationId: publication.id,
  })));
  await recordPublicationCrawl(publication.id, { status: "ok", etag, lastModified, hubUrl }, POOL_CRAWL_LIMITS.maxFailures);
  return stories;
}

/** `only` limits a cycle to given publication ids (and their stories), e.g. to crawl a newly added source at once. */
export async function runPoolCrawlCycle(assertConnected: () => Promise<void> = async () => undefined, now = new Date(), only?: readonly string[]): Promise<PoolCrawlStats> {
  const stats: PoolCrawlStats = { publications: 0, failed: 0, newStories: 0, readable: 0, unreadable: 0, duplicates: 0, probed: 0, registered: 0, gdeltStories: 0, gdeltSites: 0, leases: 0, pruned: 0 };
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
    // Growing the catalogue: a few of the most-seen publisher domains are probed for a feed each cycle.
    await assertConnected();
    const probe = await probeDiscoveredSites(POOL_CRAWL_LIMITS.sitesPerCycle, controller.signal);
    stats.probed = probe.probed; stats.registered = probe.registered;
    // GDELT: the newest global file, filtered to what anyone here watches. Its failure is its own.
    if (!only && process.env.GDELT_ENABLED !== "false") {
      await assertConnected();
      const gdelt = await ingestLatestGdelt(controller.signal)
        .catch(error => { console.warn(`[pool-crawl] GDELT skipped: ${error instanceof Error ? error.message : "error"}`); return null; });
      if (gdelt) { stats.gdeltStories = gdelt.stored; stats.gdeltSites = gdelt.sites; }
    }
    // Push: feeds that name a hub get a lease, so their updates arrive without a poll.
    if (!only && process.env.WEBSUB_ENABLED !== "false") {
      await assertConnected();
      const leases = await renewWebSubLeases(POOL_CRAWL_LIMITS.leasesPerCycle, process.env.APP_URL ?? "https://www.thesocialpundit.com", controller.signal)
        .catch(() => ({ requested: 0, failed: 0 }));
      stats.leases = leases.requested;
    }
    stats.pruned = only ? 0 : await prunePool(POOL_RETENTION_DAYS, 2000);
    console.log(`[pool-crawl] ${stats.publications} publications (${stats.failed} failed), ${stats.newStories} new stories, ${stats.readable} readable + ${stats.unreadable} unreadable bodies, ${stats.duplicates} duplicate bodies demoted, ${stats.probed} sites probed (${stats.registered} registered), GDELT ${stats.gdeltStories} stories + ${stats.gdeltSites} sites, ${stats.leases} push leases, ${stats.pruned} pruned`);
    lastPoolCrawl = { at: new Date(), stats };
    return stats;
  } finally {
    clearTimeout(timer);
  }
}
