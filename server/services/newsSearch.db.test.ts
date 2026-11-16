import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireLocalTestDatabase } from "../../test/database-safety";

// Opt-in: runs the shared-pool search SQL against the explicit local test database as tsp_app.
// Unique fixture URLs only, removed afterwards; the pool is not tenant-scoped.
const enabled = process.env.NEWS_SEARCH_DB_TESTS === "true";

describe.skipIf(!enabled)("searchArticlePool on PostgreSQL", () => {
  let app: typeof import("../db");
  let owner: typeof import("../../test/db-owner");
  let service: typeof import("./newsSearch");
  let parse: typeof import("@shared/news-search").parseNewsQuery;
  const host = `pool-${randomUUID().slice(0, 8)}.test`;
  const now = new Date();
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const window: { from: Date | null; to: Date | null } = { from: daysAgo(30), to: null };

  beforeAll(async () => {
    const target = requireLocalTestDatabase();
    app = await import("../db");
    owner = await import("../../test/db-owner");
    service = await import("./newsSearch");
    parse = (await import("@shared/news-search")).parseNewsQuery;
    expect((await app.pool.query("select current_user, current_database()")).rows[0]).toEqual({ current_user: "tsp_app", current_database: target.database });
    const rows: Array<[string, string, string, string, Date]> = [
      [`https://www.${host}/a`, "Retail media networks raise prices", "Ad Brief", "Brands move budgets to retail media.", daysAgo(1)],
      [`https://news.${host}/b`, "Retail media and crypto ads", "Crypto Desk", "Crypto brands buy retail media.", daysAgo(2)],
      [`https://${host}/c`, "Retail media last quarter", "Ad Brief", "Old news on retail media.", daysAgo(45)],
      [`https://other-${host}/d`, "Cloud costs in focus", "Wire", "Nothing about shops.", daysAgo(1)],
      [`https://${host}/amazon-ads`, "Amazon ad business grows", "Wire", "Sponsored products lead.", daysAgo(1)],
      [`https://${host}/walmart`, "Walmart expands its store network", "Wire", "Retail stores add pickup lockers.", daysAgo(1)],
      [`https://${host}/sales`, "Holiday sales forecast", "Wire", "Retail spending rises.", daysAgo(1)],
      [`https://${host}/amazon-crypto`, "Amazon tests crypto checkout", "Wire", "Retail payments with crypto.", daysAgo(1)],
    ];
    for (const [url, title, source, content, published] of rows) {
      // published_at is timestamp without time zone holding UTC, as Drizzle writes it.
      await owner.ownerPool.query("INSERT INTO pooled_articles (canonical_url, title, source, content, published_at) VALUES ($1, $2, $3, $4, $5)", [url, title, source, content, published.toISOString()]);
    }
  });
  afterAll(async () => {
    try { await owner?.ownerPool.query("DELETE FROM pooled_articles WHERE canonical_url LIKE $1", [`%${host}/%`]); }
    finally { await app?.pool.end(); await owner?.ownerPool.end(); }
  });

  const urls = async (query: string, extra: Partial<typeof window> = {}) =>
    (await service.searchArticlePool(parse(query), { ...window, ...extra }, 80)).map(article => article.link).filter(link => link.includes(host)).sort();

  it("matches words with stemming, phrases, OR and exclusions inside the window", async () => {
    expect(await urls("retail network")).toEqual([`https://${host}/walmart`, `https://www.${host}/a`]);
    expect(await urls("brand")).toEqual([`https://news.${host}/b`, `https://www.${host}/a`]);
    expect(await urls(`"retail media" -crypto`)).toEqual([`https://www.${host}/a`]);
    expect(await urls("prices OR crypto")).toEqual([`https://news.${host}/b`, `https://${host}/amazon-crypto`, `https://www.${host}/a`]);
    expect(await urls("retail", { from: daysAgo(60) })).toHaveLength(6);
    expect(await urls("retail", { from: daysAgo(60), to: daysAgo(30) })).toEqual([`https://${host}/c`]);
  });

  it("keeps OR inside its group and applies exclusions to every group", async () => {
    expect(await urls("amazon OR walmart retail")).toEqual([`https://${host}/amazon-crypto`, `https://${host}/walmart`]);
    expect(await urls("retail amazon OR walmart -crypto")).toEqual([`https://${host}/walmart`]);
    expect(await urls(`amazon OR walmart retail -"pickup lockers"`)).toEqual([`https://${host}/amazon-crypto`]);
    expect(await urls("the retail amazon")).toEqual([`https://${host}/amazon-crypto`]);
  });

  it("filters by source name and by site including subdomains, with or without words", async () => {
    expect(await urls("retail source:\"ad brief\"")).toEqual([`https://www.${host}/a`]);
    expect(await urls(`site:${host}`)).toEqual([`https://news.${host}/b`, `https://${host}/amazon-ads`, `https://${host}/amazon-crypto`, `https://${host}/sales`, `https://${host}/walmart`, `https://www.${host}/a`]);
    expect(await urls(`retail site:news.${host}`)).toEqual([`https://news.${host}/b`]);
    expect(await urls("source:100%_brief")).toEqual([]);
  });

  it("returns readable article fields and nothing without terms or filters", async () => {
    const [article] = await service.searchArticlePool(parse(`"networks raise prices" site:${host}`), window, 5);
    expect(article).toMatchObject({ title: "Retail media networks raise prices", source: "Ad Brief", content: "Brands move budgets to retail media." });
    expect(new Date(article.publishedAt!).getTime()).toBeCloseTo(daysAgo(1).getTime(), -4);
    expect(await service.searchArticlePool(parse("-crypto"), window, 5)).toEqual([]);
  });
});
