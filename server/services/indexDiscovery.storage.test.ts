import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requireLocalTestDatabase } from "../../test/database-safety";
import { pool } from "../db";
import { ownerDb, ownerPool } from "../../test/db-owner";
import { discoveredSites, publications, watchTerms } from "@shared/schema";
import { dueDiscoveredSites, harvestOutboundOrigins, noteDiscoveredSites, noteWatchTerms, probeDiscoveredSites, watchTermList } from "./indexDiscovery";

// Runs through the tsp_app role, as production does. Rows are tagged so parallel test files never collide.
const tag = `disc-${randomUUID().slice(0, 8)}`;
const site = (name: string) => `https://${name}.${tag}.example.invalid`;
const term = (value: string) => `${value} ${tag}`;
let validated = false;

beforeAll(async () => {
  requireLocalTestDatabase();
  const role = await pool.query("select rolsuper, rolbypassrls from pg_roles where rolname = current_user");
  expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  validated = true;
});
afterAll(async () => {
  if (validated) {
    await ownerDb.delete(discoveredSites).where(like(discoveredSites.origin, `%.${tag}.example.invalid`));
    await ownerDb.delete(publications).where(like(publications.feedUrl, `%.${tag}.example.invalid/%`));
    await ownerDb.delete(watchTerms).where(like(watchTerms.term, `%${tag}`));
  }
  await pool.end(); await ownerPool.end();
});

describe("discovered sites", () => {
  it("remembers each publisher domain once, counting the refreshes that saw it", async () => {
    expect(await noteDiscoveredSites([`${site("trade")}/story/1?x=1`, `${site("trade")}/story/2`, `${site("Journal")}/`], "search")).toBe(2);
    expect(await noteDiscoveredSites([`${site("trade")}/story/3`], "link")).toBe(0);
    const rows = await ownerDb.select().from(discoveredSites).where(inArray(discoveredSites.origin, [site("trade"), site("journal")]));
    expect(rows.find(row => row.origin === site("trade"))).toMatchObject({ seenVia: "search", seenCount: 2, status: "pending" });
    expect(rows.find(row => row.origin === site("journal"))).toMatchObject({ seenCount: 1 });
  });

  it("ignores networks, search engines, aggregators and non-web addresses", async () => {
    expect(await noteDiscoveredSites([
      "https://www.linkedin.com/posts/x", "https://twitter.com/a", "https://news.google.com/rss", "https://www.msn.com/en-in/a",
      "https://en.wikipedia.org/wiki/A", "https://cdn.example.invalid/x.js", "javascript:alert(1)", "http://127.0.0.1/",
    ], "link")).toBe(0);
  });

  it("probes the most-seen pending sites first, and only link-only sites seen more than once", async () => {
    await noteDiscoveredSites([`${site("once")}/a`], "link");
    await noteDiscoveredSites([`${site("twice")}/a`], "link");
    await noteDiscoveredSites([`${site("twice")}/b`], "link");
    const due = (await dueDiscoveredSites(10)).map(row => row.origin).filter(origin => origin.endsWith(`.${tag}.example.invalid`));
    expect(due).toEqual([site("trade"), site("twice"), site("journal")]);
  });

  it("registers a probed site's feed as a discovered publication, or records that it has none", async () => {
    await noteDiscoveredSites([`${site("vendor")}/`, `${site("vendor")}/pricing`], "search");
    const discover = vi.fn(async (origin: string) => origin === site("trade")
      ? { name: "Trade Weekly &amp; Wire | Industry news", feedUrl: `${origin}/feed.xml`, sourceType: "feed" as const }
      // A homepage with no feed (a software vendor, say) is not a publisher to crawl.
      : origin === site("vendor") ? { name: "Vendor | Digital Experience Platform", feedUrl: `${origin}/`, sourceType: "webpage" as const }
      : { error: "No feed or article list found" });
    const result = await probeDiscoveredSites(10, undefined, discover);
    expect(result.probed).toBeGreaterThanOrEqual(3);
    const rows = await ownerDb.select().from(discoveredSites).where(like(discoveredSites.origin, `%.${tag}.example.invalid`));
    const trade = rows.find(row => row.origin === site("trade"))!;
    expect(trade).toMatchObject({ status: "registered" });
    const [publication] = await ownerDb.select().from(publications).where(eq(publications.id, trade.publicationId!));
    expect(publication).toMatchObject({ name: "Trade Weekly & Wire", feedUrl: `${site("trade")}/feed.xml`, addedVia: "discovered", isActive: true });
    expect(rows.find(row => row.origin === site("vendor"))).toMatchObject({ status: "no-feed", note: "Only a web page, no RSS or Atom feed", publicationId: null });
    expect(await ownerDb.select().from(publications).where(eq(publications.feedUrl, `${site("vendor")}/`))).toEqual([]);
    expect(rows.find(row => row.origin === site("journal"))).toMatchObject({ status: "no-feed", note: "No feed or article list found" });
    expect(rows.find(row => row.origin === site("once"))).toMatchObject({ status: "pending", probedAt: null });
    expect((await dueDiscoveredSites(10)).map(row => row.origin)).not.toContain(site("trade"));
  });
});

describe("watch terms", () => {
  it("keeps every account's topics, companies and people once, without the account", async () => {
    await noteWatchTerms({ keywords: [{ keyword: term("Drug Pricing"), weight: 1 }, { keyword: term("Ignored"), weight: 0 }, "ab"], companies: [term("Roche")], influencers: [term("Tukaram Mundhe")] });
    await noteWatchTerms({ keywords: [term("drug pricing")], companies: [], influencers: [] });
    const rows = await ownerDb.select().from(watchTerms).where(like(watchTerms.term, `%${tag}`));
    expect(rows.map(row => [row.term, row.kind, row.seenCount]).sort()).toEqual([
      [term("drug pricing").toLowerCase(), "keyword", 2], [term("roche").toLowerCase(), "company", 1], [term("tukaram mundhe").toLowerCase(), "person", 1],
    ]);
    expect(Object.keys(rows[0])).not.toContain("userId");
    const list = await watchTermList(1000);
    expect(list.find(entry => entry.term === term("drug pricing").toLowerCase())).toMatchObject({ kind: "keyword" });
  });
});

describe("harvestOutboundOrigins", () => {
  it("collects other publishers linked from an article, not the article's own site or networks", () => {
    const html = `<article><p>As <a href="https://www.reuters.com/business/story">Reuters</a> and <a href='https://www.ft.com/content/a'>the FT</a> reported,
      <a href="https://www.publisher.test/related">our earlier story</a>, <a href="https://twitter.com/x">tweet</a>, <a href="/local">local</a>,
      <a href="https://www.reuters.com/other">Reuters again</a>, <a href="https://static.cdn.test/a.js">script</a></p></article>`;
    expect(harvestOutboundOrigins(html, "https://publisher.test/story")).toEqual(["https://www.reuters.com", "https://www.ft.com"]);
  });

  it("follows only links a reader can click, never page-header links or web-standards sites", () => {
    // Every WordPress page carries <link rel="profile" href="http://gmpg.org/xfn/11"> in its head.
    const html = `<head><link rel="profile" href="http://gmpg.org/xfn/11"><link rel="stylesheet" href="https://fonts.example-cdn.test/a.css">
      <meta property="og:see_also" content="https://www.other.test/x"></head>
      <body><a href="https://schema.org/NewsArticle">schema</a> <a href="https://www.w3.org/TR/">W3C</a> <a class="x" href="https://www.bbc.co.uk/news/1">BBC</a></body>`;
    expect(harvestOutboundOrigins(html, "https://publisher.test/story")).toEqual(["https://www.bbc.co.uk"]);
  });
});
