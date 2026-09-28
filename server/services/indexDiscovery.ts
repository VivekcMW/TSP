import { and, desc, eq, isNull, or, sql, gte } from "drizzle-orm";
import { db } from "../db";
import { discoveredSites, publications, watchTerms } from "@shared/schema";
import { normalizeKeywords } from "@shared/profile-preferences";
import { validateUrlSync } from "./urlValidator";
import { discoverFeed, type DiscoveredFeed, type FeedDiscoveryError } from "./feedDiscovery";
import { registerPublications, type PoolProfile } from "./articlePool";

/**
 * Shared index, Stage 2: growing the catalogue without a search engine. Every publisher domain
 * seen behind a search result, an outbound link or a GDELT record is remembered; the crawler
 * probes the most-seen ones for a feed and registers what it finds. Watch terms are the
 * topics, companies and people across all accounts, kept without the account, so global
 * feeds can be filtered to what anyone here cares about.
 */

export type SeenVia = "search" | "link" | "gdelt";

// Networks, search engines, aggregators and infrastructure: never publishers to crawl.
const NOT_PUBLISHERS = [
  "google.com", "googleapis.com", "gstatic.com", "bing.com", "msn.com", "yahoo.com", "duckduckgo.com",
  "facebook.com", "fb.com", "instagram.com", "twitter.com", "x.com", "t.co", "linkedin.com", "youtube.com", "youtu.be",
  "reddit.com", "pinterest.com", "tiktok.com", "threads.net", "bsky.app", "whatsapp.com", "telegram.org", "t.me",
  "wikipedia.org", "wikimedia.org", "amazon.com", "apple.com", "github.com", "medium.com", "substack.com",
  "doubleclick.net", "cloudflare.com", "akamaihd.net", "cloudfront.net",
];
const INFRASTRUCTURE_HOST = /^(?:cdn|static|assets|img|images|media|api|ads?)\d*\./i;
const MAX_ORIGINS_PER_CALL = 50;
const MAX_OUTBOUND_PER_PAGE = 20;
const TERM_MIN = 3;
const TERM_MAX = 80;

function bareHost(hostname: string) { return hostname.toLowerCase().replace(/^www\./, ""); }

/** `https://host` for a public web address that could be a publisher, else null. */
export function publisherOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (NOT_PUBLISHERS.some(blocked => host === blocked || host.endsWith(`.${blocked}`)) || INFRASTRUCTURE_HOST.test(host)) return null;
    const origin = `${url.protocol}//${host}${url.port ? `:${url.port}` : ""}`;
    return validateUrlSync(`${origin}/`) ? origin : null;
  } catch {
    return null;
  }
}

/** Remembers publisher domains; a known one gets its count raised. Returns how many were new. */
export async function noteDiscoveredSites(urls: readonly string[], via: SeenVia): Promise<number> {
  const origins = new Set<string>();
  for (const value of urls) {
    const origin = publisherOrigin(value);
    if (origin) origins.add(origin);
    if (origins.size >= MAX_ORIGINS_PER_CALL) break;
  }
  if (!origins.size) return 0;
  const rows = await db.insert(discoveredSites).values([...origins].map(origin => ({ origin, seenVia: via })))
    .onConflictDoUpdate({ target: discoveredSites.origin, set: { seenCount: sql`${discoveredSites.seenCount} + 1`, lastSeenAt: new Date() } })
    .returning({ firstSeenAt: discoveredSites.firstSeenAt, lastSeenAt: discoveredSites.lastSeenAt });
  return rows.filter(row => row.firstSeenAt.getTime() === row.lastSeenAt.getTime()).length;
}

/** Pending sites worth a probe: seen behind a search result, or linked from more than one story. Most seen first; search-seen ahead on ties. */
export async function dueDiscoveredSites(limit: number) {
  return db.select().from(discoveredSites)
    .where(and(eq(discoveredSites.status, "pending"), isNull(discoveredSites.probedAt), or(eq(discoveredSites.seenVia, "search"), gte(discoveredSites.seenCount, 2))))
    .orderBy(desc(discoveredSites.seenCount), sql`case when ${discoveredSites.seenVia} = 'search' then 0 else 1 end`, desc(discoveredSites.lastSeenAt))
    .limit(Math.max(1, Math.min(limit, 100)));
}

type Discover = (origin: string, signal?: AbortSignal) => Promise<DiscoveredFeed | FeedDiscoveryError>;

/** Probes due sites for a feed. A found feed becomes a publication (added_via "discovered"); a miss is recorded. */
export async function probeDiscoveredSites(limit: number, signal?: AbortSignal, discover: Discover = discoverFeed): Promise<{ probed: number; registered: number }> {
  const due = await dueDiscoveredSites(limit);
  let registered = 0;
  for (const site of due) {
    if (signal?.aborted) break;
    const found = await discover(site.origin, signal).catch((error: unknown): FeedDiscoveryError => ({ error: error instanceof Error ? error.message : "Probe failed" }));
    if ("error" in found) {
      await db.update(discoveredSites).set({ status: "no-feed", probedAt: new Date(), note: found.error.slice(0, 300) }).where(eq(discoveredSites.id, site.id));
      continue;
    }
    await registerPublications([{ name: found.name, feedUrl: found.feedUrl, sourceType: found.sourceType, addedVia: "discovered" }]);
    const [publication] = await db.select({ id: publications.id }).from(publications).where(eq(publications.feedUrl, found.feedUrl)).limit(1);
    await db.update(discoveredSites).set({ status: "registered", probedAt: new Date(), publicationId: publication?.id ?? null, note: null }).where(eq(discoveredSites.id, site.id));
    registered++;
  }
  return { probed: due.length, registered };
}

/** Adds an account's topics, companies and people to the shared watch list, without the account. */
export async function noteWatchTerms(profile: PoolProfile): Promise<void> {
  const rows = new Map<string, { term: string; kind: "keyword" | "company" | "person" }>();
  const groups: Array<[readonly Parameters<typeof normalizeKeywords>[0][number][], "keyword" | "company" | "person"]> =
    [[profile.keywords ?? [], "keyword"], [profile.companies ?? [], "company"], [profile.influencers ?? [], "person"]];
  for (const [values, kind] of groups) {
    for (const keyword of normalizeKeywords(values)) {
      const term = keyword.keyword.toLowerCase().replace(/\s+/g, " ").trim();
      if (keyword.weight <= 0 || term.length < TERM_MIN || term.length > TERM_MAX || rows.has(term)) continue;
      rows.set(term, { term, kind });
    }
  }
  if (!rows.size) return;
  await db.insert(watchTerms).values([...rows.values()])
    .onConflictDoUpdate({ target: watchTerms.term, set: { seenCount: sql`${watchTerms.seenCount} + 1`, lastSeenAt: new Date() } });
}

/** The most-watched terms, for filtering global feeds. */
export async function watchTermList(limit: number): Promise<Array<{ term: string; kind: string }>> {
  return db.select({ term: watchTerms.term, kind: watchTerms.kind }).from(watchTerms)
    .orderBy(desc(watchTerms.seenCount), desc(watchTerms.lastSeenAt)).limit(Math.max(1, Math.min(limit, 2000)));
}

/** Other publishers an article links to, in order of appearance, without its own site. */
export function harvestOutboundOrigins(html: string, pageUrl: string): string[] {
  let own: string;
  try { own = bareHost(new URL(pageUrl).hostname); } catch { return []; }
  const origins: string[] = [];
  for (const match of html.matchAll(/href\s*=\s*["'](https?:\/\/[^"'\s>]+)/gi)) {
    const origin = publisherOrigin(match[1]);
    if (!origin || bareHost(new URL(origin).hostname) === own || origins.includes(origin)) continue;
    origins.push(origin);
    if (origins.length >= MAX_OUTBOUND_PER_PAGE) break;
  }
  return origins;
}
