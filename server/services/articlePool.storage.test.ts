import { randomUUID } from "node:crypto";
import { inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireLocalTestDatabase } from "../../test/database-safety";
import { pool } from "../db";
import { ownerDb, ownerPool } from "../../test/db-owner";
import { pooledArticles, publications } from "@shared/schema";
import { findPooledArticle, indexHealth, knownUnreadableLinks, markPooledBody, pendingPooledBodies, prunePool, queryArticlePool, registerPublications, storePooledArticles } from "./articlePool";

// Runs through the tsp_app role, as production does. Rows are tagged so parallel test files never collide.
const tag = `pool-${randomUUID().slice(0, 8)}`;
const site = (name: string) => `https://${name}.${tag}.example.invalid`;
const DAY = 86_400_000;
let validated = false;

beforeAll(async () => {
  requireLocalTestDatabase();
  const role = await pool.query("select rolsuper, rolbypassrls from pg_roles where rolname = current_user");
  expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  validated = true;
});
afterAll(async () => {
  if (validated) {
    await ownerDb.delete(pooledArticles).where(like(pooledArticles.canonicalUrl, `%.${tag}.example.invalid/%`));
    await ownerDb.delete(publications).where(like(publications.feedUrl, `%.${tag}.example.invalid/%`));
  }
  await pool.end(); await ownerPool.end();
});

describe("publications catalogue", () => {
  it("registers each feed once, whoever picked it, and keeps the first name", async () => {
    const feed = `${site("trade")}/feed.xml`;
    const first = await registerPublications([{ name: "Trade Weekly", feedUrl: feed, sourceType: "feed" }]);
    const again = await registerPublications([{ name: "trade weekly (copy)", feedUrl: feed, sourceType: "feed" }, { name: "Trade Weekly", feedUrl: ` ${feed} `, sourceType: "feed" }]);
    expect(first).toBe(1);
    expect(again).toBe(0);
    const rows = await ownerDb.select().from(publications).where(inArray(publications.feedUrl, [feed]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Trade Weekly", siteUrl: site("trade"), sourceType: "feed", isActive: true, addedVia: "user-source" });
  });

  it("shows publication names as text, not HTML codes", async () => {
    const feed = `${site("coded")}/feed.xml`;
    await registerPublications([{ name: "Search &amp; Speed &#39;Weekly&#39;", feedUrl: feed, sourceType: "feed" }]);
    expect((await ownerDb.select().from(publications).where(inArray(publications.feedUrl, [feed])))[0].name).toBe("Search & Speed 'Weekly'");
  });

  it("ignores sources that aren't public web addresses", async () => {
    expect(await registerPublications([{ name: "Bad", feedUrl: "javascript:alert(1)", sourceType: "feed" }, { name: "Local", feedUrl: "http://127.0.0.1/feed", sourceType: "feed" }])).toBe(0);
  });
});

describe("article pool", () => {
  const story = (path: string, title: string, extra: Partial<Parameters<typeof storePooledArticles>[0][number]> = {}) => ({
    link: `${site("pharma")}${path}`, title, source: "Pharma Daily", content: `${title}. Full report to follow.`, publishedAt: new Date(Date.now() - DAY).toISOString(), ...extra,
  });

  it("stores each story once by canonical link and finds it by any of a person's terms", async () => {
    const stored = await storePooledArticles([
      story("/nppa-caps-stent-prices?utm_source=rss", "NPPA caps stent prices again"),
      story("/roche-obesity-drug", "Roche drops obesity candidate"),
      story("/nppa-caps-stent-prices", "NPPA caps stent prices again (duplicate)"),
    ]);
    expect(stored).toBe(2);
    const found = await queryArticlePool({ keywords: ["stent prices"], companies: ["Roche"], influencers: [] }, { days: 30, limit: 50 });
    expect(found.map(article => article.title).sort()).toEqual(["NPPA caps stent prices again", "Roche drops obesity candidate"]);
    expect(found[0]).toMatchObject({ source: "Pharma Daily", inputKind: "feed_excerpt", sourceOrigin: site("pharma"), categories: [] });
    expect(found.every(article => !article.link.includes("utm_source"))).toBe(true);
  });

  it("repairs a feed link that repeats its site address", async () => {
    await storePooledArticles([story("", "Doubled link story", { link: `${site("pharma")}/${site("pharma")}/news/doubled-21989` })]);
    expect(await findPooledArticle(`${site("pharma")}/news/doubled-21989`)).toMatchObject({ title: "Doubled link story" });
  });

  it("matches every word of a term in any order or form, but not a lone word, and ignores old stories", async () => {
    await storePooledArticles([
      story("/generic-prices", "Generic drug prices fall", { publishedAt: new Date(Date.now() - 45 * DAY).toISOString() }),
      story("/stent-prices-word-order", "Prices of stents: a reversal"),
      story("/stent-ipo", "Stent maker files for an IPO"),
    ]);
    const found = await queryArticlePool({ keywords: ["stent prices", "drug prices"], companies: [], influencers: [] }, { days: 30, limit: 50 });
    expect(found.map(article => article.title).sort()).toEqual(["NPPA caps stent prices again", "Prices of stents: a reversal"]);
  });

  it("returns nothing for an empty profile without touching the database", async () => {
    expect(await queryArticlePool({ keywords: [], companies: [], influencers: [] }, { days: 30, limit: 50 })).toEqual([]);
  });

  it("serves the fetched body to generation and to later refreshes, and knows what's unreadable", async () => {
    const url = `${site("pharma")}/nppa-caps-stent-prices`;
    expect((await pendingPooledBodies(100)).map(row => row.canonicalUrl)).toContain(url);
    await markPooledBody(url, { readable: true, content: "The National Pharmaceutical Pricing Authority capped coronary stent prices for a third year. ".repeat(20), title: "NPPA caps stent prices for a third year" });
    await markPooledBody(`${site("pharma")}/roche-obesity-drug`, { readable: false });
    const article = await findPooledArticle(`${url}?utm_medium=email`);
    expect(article).toMatchObject({ readable: true, inputKind: "page_body", title: "NPPA caps stent prices for a third year", source: "Pharma Daily" });
    expect(article!.content.length).toBeGreaterThan(1000);
    expect(await findPooledArticle(`${site("pharma")}/roche-obesity-drug`)).toMatchObject({ readable: false });
    expect(await findPooledArticle(`${site("pharma")}/never-seen`)).toBeNull();
    expect(await knownUnreadableLinks([`${site("pharma")}/roche-obesity-drug?utm_source=x`, url, `${site("pharma")}/never-seen`, "not a url"]))
      .toEqual([`${site("pharma")}/roche-obesity-drug`]);
    expect(await knownUnreadableLinks([])).toEqual([]);
    expect((await pendingPooledBodies(100)).map(row => row.canonicalUrl)).not.toContain(url);
    const refreshed = await queryArticlePool({ keywords: ["stent prices"], companies: [], influencers: [] }, { days: 30, limit: 50 });
    expect(refreshed.find(article => article.link === url)).toMatchObject({ inputKind: "page_body", title: "NPPA caps stent prices for a third year" });
  });

  it("prunes stories older than the retention window", async () => {
    await storePooledArticles([story("/ancient", "Ancient story", { publishedAt: new Date(Date.now() - 400 * DAY).toISOString() })]);
    const pruned = await prunePool(30, 1000);
    expect(pruned).toBeGreaterThanOrEqual(2);
    expect(await findPooledArticle(`${site("pharma")}/ancient`)).toBeNull();
    expect(await findPooledArticle(`${site("pharma")}/generic-prices`)).toBeNull();
    expect(await findPooledArticle(`${site("pharma")}/nppa-caps-stent-prices`)).not.toBeNull();
  });
});

describe("indexHealth", () => {
  it("counts the catalogue, discovery, pool and watch terms", async () => {
    const health = await indexHealth();
    expect(health.publications.active).toBeGreaterThanOrEqual(1);
    expect(health.pool.stories).toBeGreaterThanOrEqual(health.pool.readable + health.pool.unreadable + health.pool.pending);
    expect(health).toMatchObject({ discovered: expect.objectContaining({ pending: expect.any(Number) }), watchTerms: expect.any(Number) });
  });
});
