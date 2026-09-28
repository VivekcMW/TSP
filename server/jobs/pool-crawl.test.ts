import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { requireLocalTestDatabase } from "../../test/database-safety";
import { pool } from "../db";
import { ownerDb, ownerPool } from "../../test/db-owner";
import { discoveredSites, pooledArticles, publications } from "@shared/schema";

// Real database through the tsp_app role; only the network is a fixture.
const { crawl, network } = vi.hoisted(() => ({ crawl: vi.fn(), network: vi.fn(() => { throw new Error("Unexpected network request"); }) }));
vi.mock("../services/crawlerFetch", async original => ({ ...await original<typeof import("../services/crawlerFetch")>(), fetchPublicText: crawl }));
vi.mock("node-fetch", () => ({ default: network }));
const { discover } = vi.hoisted(() => ({ discover: vi.fn() }));
vi.mock("../services/feedDiscovery", async original => ({ ...await original<typeof import("../services/feedDiscovery")>(), discoverFeed: discover }));
// GDELT has its own tests (gdelt.test.ts); the cycle only needs its summary here.
vi.mock("../services/gdelt", () => ({ ingestLatestGdelt: async () => ({ file: null, records: 0, matched: 0, stored: 0, sites: 0 }) }));
import { CrawlError } from "../services/crawlerFetch";
import { forgetRobots } from "../services/robots";
import { registerPublications, findPooledArticle } from "../services/articlePool";
import { runPoolCrawlCycle } from "./pool-crawl";

const tag = `crawl-${randomUUID().slice(0, 8)}`;
const host = `https://daily.${tag}.example.invalid`;
const feed = `${host}/feed.xml`;
const page = (text: string, status = 200, headers: Record<string, string> = {}) => ({ url: "", text, status, headers: new Headers(headers) });
const at = (url: string, response: ReturnType<typeof page>) => ({ ...response, url });
const article = (title: string) => `<html><head><title>${title}</title><meta property="og:site_name" content="Daily Pharma"></head><body><article>${`<p>${title}. ${"Regulators met device makers to discuss price caps and trade margins across the sector. ".repeat(3)}</p>`.repeat(6)}<p>As <a href="https://www.wire.${tag}.example.invalid/story">the wire</a> reported.</p></article></body></html>`;
const rss = (items: Array<[string, string]>) => `<rss version="2.0"><channel><title>Daily</title>${items.map(([title, path]) =>
  `<item><title>${title}</title><link>${host}${path}</link><description>${title} excerpt</description><pubDate>${new Date().toUTCString()}</pubDate></item>`).join("")}</channel></rss>`;
let validated = false;

beforeAll(async () => {
  requireLocalTestDatabase();
  const role = await pool.query("select rolsuper, rolbypassrls from pg_roles where rolname = current_user");
  expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  validated = true;
  vi.spyOn(console, "log").mockImplementation(() => {});
  await registerPublications([{ name: "Daily", feedUrl: feed, sourceType: "feed" }]);
});
afterAll(async () => {
  if (validated) {
    await ownerDb.delete(pooledArticles).where(like(pooledArticles.canonicalUrl, `${host}/%`));
    await ownerDb.delete(publications).where(like(publications.feedUrl, `${host}/%`));
    await ownerDb.delete(publications).where(like(publications.feedUrl, `%.${tag}.example.invalid/%`));
    await ownerDb.delete(discoveredSites).where(like(discoveredSites.origin, `%.${tag}.example.invalid`));
  }
  await pool.end(); await ownerPool.end();
  vi.restoreAllMocks();
});
beforeEach(() => { crawl.mockReset(); discover.mockReset(); discover.mockResolvedValue({ error: "No feed" }); forgetRobots(); });

const publication = async () => (await ownerDb.select().from(publications).where(eq(publications.feedUrl, feed)))[0];
// Other test files share this database, so each cycle is limited to this file's publication.
const cycle = async () => runPoolCrawlCycle(undefined, new Date(), [(await publication()).id]);

describe("shared index crawl cycle", () => {
  it("polls a due publication, stores its stories, then fetches and keeps their readable bodies", async () => {
    crawl.mockImplementation(async (url: string, options?: { headers?: Record<string, string> }) => {
      if (url.endsWith("/robots.txt")) return page("User-agent: *\nDisallow: /members/");
      if (url === feed) { expect(options?.headers ?? {}).toEqual({}); return page(rss([["Stent price caps", "/stent-caps"], ["Members only", "/members/secret"], ["Moved story", "/moved"], ["Listing only", "/listing"], ["Twin of the stent story", "/twin"]]), 200, { etag: '"v1"', "last-modified": "Mon, 28 Sep 2026 06:00:00 GMT" }); }
      if (url === `${host}/stent-caps`) return at(url, page(article("Stent price caps"), 200, { "content-type": "text/html" }));
      // The same body under a second headline (a site's boilerplate block), a story that now
      // redirects to the front page, and a page holding only a list of links.
      if (url === `${host}/twin`) return at(url, page(article("Stent price caps"), 200, { "content-type": "text/html" }));
      if (url === `${host}/moved`) return at(`${host}/`, page(article("Front page"), 200, { "content-type": "text/html" }));
      if (url === `${host}/listing`) return at(url, page(`<html><body><main>${Array.from({ length: 30 }, (_, i) => `<p><a href="/s${i}">Story number ${i} about pricing and margins in the sector</a></p>`).join("")}</main></body></html>`, 200, { "content-type": "text/html" }));
      throw new CrawlError("http", `unexpected ${url}`);
    });
    const stats = await cycle();
    expect(stats).toMatchObject({ publications: 1, newStories: 5, readable: 2, unreadable: 3, duplicates: 1 });
    expect(await publication()).toMatchObject({ lastCrawlStatus: "ok", consecutiveFailures: 0, etag: '"v1"', lastModified: "Mon, 28 Sep 2026 06:00:00 GMT" });
    const kept = await findPooledArticle(`${host}/stent-caps`);
    expect(kept).toMatchObject({ readable: true, inputKind: "page_body", source: "Daily", title: "Stent price caps" });
    expect(kept!.content).toContain("price caps and trade margins");
    // robots.txt forbade /members/, so that story is recorded as unreadable without a page fetch.
    expect(await findPooledArticle(`${host}/members/secret`)).toMatchObject({ readable: false });
    expect(crawl.mock.calls.map(([url]) => url)).not.toContain(`${host}/members/secret`);
    expect(await findPooledArticle(`${host}/moved`)).toMatchObject({ readable: false, title: "Moved story" });
    expect(await findPooledArticle(`${host}/listing`)).toMatchObject({ readable: false, inputKind: "feed_excerpt" });
    expect(await findPooledArticle(`${host}/twin`)).toMatchObject({ readable: false, title: "Twin of the stent story" });
    // Three fetched pages linked to another publisher: remembered for discovery, and, seen more than once, probed in the same cycle (no feed here).
    expect(await ownerDb.select().from(discoveredSites).where(eq(discoveredSites.origin, `https://www.wire.${tag}.example.invalid`)))
      .toEqual([expect.objectContaining({ seenVia: "link", seenCount: 3, status: "no-feed" })]);
  });

  it("probes discovered sites for feeds and registers what it finds", async () => {
    await ownerDb.insert(discoveredSites).values({ origin: `https://found.${tag}.example.invalid`, seenVia: "search" });
    discover.mockImplementation(async (origin: string) => ({ name: "Found Weekly", feedUrl: `${origin}/rss`, sourceType: "feed" }));
    crawl.mockRejectedValue(new CrawlError("http", "nothing to poll"));
    const stats = await cycle();
    expect(stats).toMatchObject({ probed: 1, registered: 1 });
    expect(await ownerDb.select().from(publications).where(eq(publications.feedUrl, `https://found.${tag}.example.invalid/rss`)))
      .toEqual([expect.objectContaining({ name: "Found Weekly", addedVia: "discovered" })]);
  });

  it("asks conditionally next time and leaves an unchanged feed alone", async () => {
    await ownerDb.update(publications).set({ lastCrawledAt: new Date(Date.now() - 3_600_000) }).where(eq(publications.feedUrl, feed));
    crawl.mockImplementation(async (url: string, options?: { headers?: Record<string, string> }) => {
      if (url === feed) { expect(options?.headers).toEqual({ "If-None-Match": '"v1"', "If-Modified-Since": "Mon, 28 Sep 2026 06:00:00 GMT" }); return page("", 304); }
      throw new CrawlError("http", `unexpected ${url}`);
    });
    const stats = await cycle();
    expect(stats).toMatchObject({ publications: 1, newStories: 0 });
    expect(await publication()).toMatchObject({ lastCrawlStatus: "unchanged", etag: '"v1"' });
  });

  it("skips a publication polled recently, and records failures until it is switched off", async () => {
    expect((await cycle()).publications).toBe(0);
    await ownerDb.update(publications).set({ lastCrawledAt: new Date(Date.now() - 3_600_000), consecutiveFailures: 9 }).where(eq(publications.feedUrl, feed));
    crawl.mockRejectedValue(new CrawlError("network", "The source could not be reached."));
    const stats = await cycle();
    expect(stats).toMatchObject({ publications: 1, failed: 1 });
    expect(await publication()).toMatchObject({ lastCrawlStatus: "error", lastCrawlError: "The source could not be reached.", consecutiveFailures: 10, isActive: false });
  });
});
