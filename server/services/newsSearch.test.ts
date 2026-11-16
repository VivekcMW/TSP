import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {} }));
vi.mock("../lib/redis", () => ({ redis: undefined }));
vi.mock("./keywordSearch", () => ({ fetchArticlesForQuery: vi.fn() }));
vi.mock("./bingNewsSearch", () => ({ fetchBingArticlesForQuery: vi.fn() }));

import type { FetchedArticle } from "./engines/types.js";
import { searchNews, type NewsSearchCache, type NewsSearchDeps } from "./newsSearch";

const now = new Date("2026-11-16T12:00:00Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
const story = (title: string, link: string, source: string, extra: Partial<FetchedArticle> = {}): FetchedArticle => ({
  title, link, source, content: "", categories: [], pubDate: hoursAgo(2), publishedAt: hoursAgo(2), ...extra,
});

function makeDeps(overrides: Partial<NewsSearchDeps> = {}) {
  const deps = {
    searchPool: vi.fn(async () => [] as FetchedArticle[]),
    fetchGoogle: vi.fn(async () => [] as FetchedArticle[]),
    fetchBing: vi.fn(async () => [] as FetchedArticle[]),
    cache: null,
    now: () => now,
    deadlineMs: 1000,
    ...overrides,
  };
  return deps as typeof deps & NewsSearchDeps;
}
function memoryCache() {
  const store = new Map<string, string>();
  const cache = { get: vi.fn(async (key: string) => store.get(key) ?? null), set: vi.fn(async (key: string, value: string) => { store.set(key, value); return "OK"; }) };
  return { cache: cache as NewsSearchCache & typeof cache, store };
}
const run = (query: string, deps: NewsSearchDeps, limit = 50, edition = "en-IN") => searchNews({ query, edition, limit }, deps);
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => vi.clearAllMocks());

describe("searchNews: merging and deduplication", () => {
  it("merges the pool, Google and Bing and dedupes by canonical URL", async () => {
    const deps = makeDeps({
      searchPool: vi.fn(async () => [story("Retail media budgets rise", "https://www.adbrief.test/a/", "Ad Brief", { content: "Brands shift retail media spend." })]),
      fetchGoogle: vi.fn(async () => [story("Retail media budgets rise - Ad Brief", "https://adbrief.test/a?utm_source=google", "Ad Brief"), story("Retail media in India", "https://desk.test/india", "Data Desk")]),
      fetchBing: vi.fn(async () => [story("Retail media budgets rise", "http://adbrief.test/a", "Ad Brief")]),
    });
    const outcome = await run("retail media", deps);
    expect(outcome.providers).toEqual({ pool: "ok", google: "ok", bing: "ok" });
    expect(outcome.results.map(result => result.url)).toEqual(["https://www.adbrief.test/a/", "https://desk.test/india"]);
    expect(outcome.results[0]).toMatchObject({ title: "Retail media budgets rise", source: "Ad Brief", snippet: "Brands shift retail media spend.", matchedTerms: ["retail", "media"], alsoCoveredBy: [] });
    expect(outcome.results[0].id).toMatch(/^[0-9a-f]{16}$/);
    expect(outcome.query).toEqual({ normalized: "retail media", warnings: [] });
  });

  it("groups near-identical headlines from other outlets under alsoCoveredBy", async () => {
    const deps = makeDeps({
      fetchGoogle: vi.fn(async () => [
        story("Retail media networks raise ad prices this quarter", "https://a.test/1", "Alpha"),
        story("Retail media networks raise ad prices this quarter - Beta News", "https://b.test/2", "Beta News"),
        story("Retail media network raises ad prices in quarter", "https://c.test/3", "Gamma"),
        story("Retail media networks raise ad prices this quarter", "https://a.test/other", "Alpha"),
        story("Retail media jobs report", "https://d.test/4", "Delta"),
      ]),
    });
    const outcome = await run("retail media", deps);
    expect(outcome.results).toHaveLength(2);
    const grouped = outcome.results.find(result => result.alsoCoveredBy.length)!;
    expect([grouped.source, ...grouped.alsoCoveredBy.map(entry => entry.source)].sort()).toEqual(["Alpha", "Beta News", "Gamma"]);
    expect(outcome.results.map(result => result.source)).toContain("Delta");
  });

  it("strips Google's publication suffix and a snippet that only repeats the headline", async () => {
    const deps = makeDeps({ fetchGoogle: vi.fn(async () => [story("AI chips ship - Wire", "https://wire.test/x", "Wire", { content: "AI chips ship  Wire" })]) });
    expect((await run("chips", deps)).results[0]).toMatchObject({ title: "AI chips ship", snippet: "" });
  });

  it("removes markup left in stored excerpts by cut-off tags", async () => {
    const content = 'scheme"button" data-redirect-url=" data-display-label="0" data-show-count="1" data-type="post" Tax courts ruled the arrangement abusive.';
    const deps = makeDeps({ searchPool: vi.fn(async () => [story("Judge finds tax scheme abusive", "https://law.test/x", "Law Wire", { content })]) });
    const [result] = (await run("tax scheme", deps)).results;
    expect(result.snippet).toBe("scheme Tax courts ruled the arrangement abusive.");
  });

  it("decodes stored entities before shortening and drops snippets with no words", async () => {
    const long = `Home &ensp;|&ensp; ${"Tax rules change again. ".repeat(12)}By A &middot; B`;
    const deps = makeDeps({ searchPool: vi.fn(async () => [
      story("Tax rules change", "https://a.test/1", "A Wire", { content: long }),
      story("Tax court ruling", "https://b.test/2", "B Wire", { content: 'data-x="1" class="y" ...' }),
    ]) });
    const results = (await run("tax", deps)).results;
    const first = results.find(item => item.url === "https://a.test/1")!;
    expect(first.snippet.startsWith("Home | Tax rules change again.")).toBe(true);
    expect(first.snippet).not.toMatch(/&[a-z]+/);
    expect(results.find(item => item.url === "https://b.test/2")!.snippet).toBe("");
  });
});

describe("searchNews: filters", () => {
  it("applies source, site, exclusions and the date window to provider results", async () => {
    const articles = [
      story("AI chips export rules", "https://www.reuters.com/a", "Reuters"),
      story("AI chips export rumor", "https://www.reuters.com/b", "Reuters"),
      story("AI chips export rules", "https://blog.test/c", "Some Blog"),
      story("AI chips export rules tighten", "https://www.reuters.com/d", "Reuters", { publishedAt: "2026-09-01T00:00:00Z", pubDate: null }),
    ];
    const deps = makeDeps({ fetchGoogle: vi.fn(async () => articles) });
    const outcome = await run("ai chips -rumor site:reuters.com", deps);
    expect(outcome.results.map(result => result.url)).toEqual(["https://www.reuters.com/a"]);
    const bySource = await run("ai chips source:\"some blog\"", makeDeps({ fetchGoogle: vi.fn(async () => articles) }));
    expect(bySource.results.map(result => result.source)).toEqual(["Some Blog"]);
  });

  it("keeps OR inside its group: provider rows that miss a required group are dropped, pool rows are trusted", async () => {
    const offTopic = [
      story("Amazon ad business grows", "https://a.test/1", "A"),
      story("Walmart retail media expands", "https://b.test/2", "B"),
      story("Retail sales rise in October", "https://c.test/3", "C"),
      story("Amazon retail push meets crypto", "https://d.test/4", "D"),
    ];
    const deps = makeDeps({
      fetchGoogle: vi.fn(async () => offTopic), fetchBing: vi.fn(async () => offTopic),
      searchPool: vi.fn(async () => [story("Grocers rethink shelves", "https://pool.test/1", "Pool", { content: "Full text matched in the database." })]),
    });
    expect((await run("amazon OR walmart retail", deps)).results.map(result => result.url).sort())
      .toEqual(["https://b.test/2", "https://d.test/4", "https://pool.test/1"]);
    expect(deps.fetchGoogle).toHaveBeenCalledWith("(amazon OR walmart) retail when:30d", 8, "en-IN", expect.any(AbortSignal));
    expect(deps.fetchBing).toHaveBeenCalledWith("(amazon OR walmart) retail", 8, "en-IN", expect.any(AbortSignal));
    expect((await run("retail amazon OR walmart -crypto", deps)).results.map(result => result.url).sort()).toEqual(["https://b.test/2", "https://pool.test/1"]);
  });

  it("re-checks required terms on provider results only when the provider query was shortened", async () => {
    const offTopic = [story("Unrelated headline", "https://x.test/1", "X")];
    expect((await run("alpha beta", makeDeps({ fetchGoogle: vi.fn(async () => offTopic) }))).results).toHaveLength(1);
    const long = `"${"a".repeat(60)}" "${"b".repeat(60)}"`;
    expect((await run(long, makeDeps({ fetchGoogle: vi.fn(async () => offTopic) }))).results).toHaveLength(0);
  });
});

describe("searchNews: ranking", () => {
  it("ranks headline matches above snippet matches and fresher stories above older ones", async () => {
    const deps = makeDeps({
      fetchGoogle: vi.fn(async () => [
        story("Quarterly update", "https://a.test/snippet", "A", { content: "Mentions retail media once." }),
        story("Retail media grows", "https://b.test/old", "B", { publishedAt: hoursAgo(24 * 20), pubDate: null }),
        story("Retail media grows fast", "https://c.test/new", "C", { publishedAt: hoursAgo(1), pubDate: null }),
      ]),
    });
    expect((await run("retail media", deps)).results.map(result => result.url)).toEqual(["https://c.test/new", "https://b.test/old", "https://a.test/snippet"]);
  });

  it("spreads sources so one outlet cannot fill the top of the list", async () => {
    const deps = makeDeps({
      fetchGoogle: vi.fn(async () => [
        story("Retail media story one", "https://big.test/1", "Big Wire", { publishedAt: hoursAgo(1), pubDate: null }),
        story("Retail media story two", "https://big.test/2", "Big Wire", { publishedAt: hoursAgo(1.5), pubDate: null }),
        story("Retail media story three", "https://big.test/3", "Big Wire", { publishedAt: hoursAgo(2), pubDate: null }),
        story("Retail media from elsewhere", "https://small.test/1", "Small Desk", { publishedAt: hoursAgo(10), pubDate: null }),
      ]),
    });
    expect((await run("retail media", deps)).results.map(result => result.source)).toEqual(["Big Wire", "Small Desk", "Big Wire", "Big Wire"]);
  });

  it("honours the limit", async () => {
    const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
    const deps = makeDeps({ fetchGoogle: vi.fn(async () => words.map((word, i) => story(`Retail ${word} report`, `https://s${i}.test/x`, `S${i}`))) });
    expect((await run("retail", deps, 3)).results).toHaveLength(3);
  });
});

describe("searchNews: providers, deadline and cache", () => {
  it("passes the provider query and edition, adds Google's date window and skips work it cannot do", async () => {
    const deps = makeDeps();
    await run(`ai "chip export" -rumor`, deps, 50, "xx-XX");
    expect(deps.fetchGoogle).toHaveBeenCalledWith(`ai "chip export" -rumor when:30d`, 8, "en-US", expect.any(AbortSignal));
    expect(deps.fetchBing).toHaveBeenCalledWith(`ai "chip export" -rumor`, 8, "en-US", expect.any(AbortSignal));
    expect(deps.searchPool).toHaveBeenCalledWith(expect.objectContaining({ textGroups: ["ai", `"chip export"`], textExclusions: ["rumor"] }), { from: new Date("2026-10-17T12:00:00Z"), to: null, explicit: false }, 80);

    const sourceOnly = makeDeps();
    expect((await run("source:Reuters", sourceOnly)).providers).toEqual({ pool: "ok", google: "skipped", bing: "skipped" });
    const old = makeDeps();
    expect((await run("ai before:2026-06-01", old)).providers.bing).toBe("skipped");
    expect(old.fetchGoogle).toHaveBeenCalledWith("ai before:2026-06-01", 8, "en-IN", expect.any(AbortSignal));
    const nothing = makeDeps();
    expect(await run("-crypto", nothing)).toEqual({ query: { normalized: "-crypto", warnings: ["Add a word, a \u201cphrase\u201d or source: to search."] }, providers: { pool: "skipped", google: "skipped", bing: "skipped" }, results: [] });
    expect(nothing.searchPool).not.toHaveBeenCalled();
  });

  it("tolerates a failed provider and reports it", async () => {
    const deps = makeDeps({
      searchPool: vi.fn(async () => [story("Retail media pool story", "https://pool.test/1", "Pool Source")]),
      fetchGoogle: vi.fn(async () => { throw new Error("Google blocked"); }),
      fetchBing: vi.fn(async () => [story("Retail media bing story", "https://bing.test/1", "Bing Source")]),
    });
    const outcome = await run("retail media", deps);
    expect(outcome.providers).toEqual({ pool: "ok", google: "failed", bing: "ok" });
    expect(outcome.results).toHaveLength(2);
  });

  it("answers by the deadline, marking a provider that has not answered as failed and aborting it", async () => {
    let aborted = false;
    const deps = makeDeps({
      deadlineMs: 50,
      fetchBing: vi.fn((_query: string, _max: number, _edition: string, signal?: AbortSignal) => new Promise<FetchedArticle[]>(() => { signal?.addEventListener("abort", () => { aborted = true; }); })),
      fetchGoogle: vi.fn(async () => [story("Retail media fast", "https://fast.test/1", "Fast")]),
    });
    const started = Date.now();
    const outcome = await run("retail media", deps);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(outcome.providers).toEqual({ pool: "ok", google: "ok", bing: "failed" });
    expect(outcome.results.map(result => result.source)).toEqual(["Fast"]);
    expect(aborted).toBe(true);
  });

  it("caches per edition and normalized query, shorter after a partial failure, never when all failed", async () => {
    const { cache, store } = memoryCache();
    const deps = makeDeps({ cache, fetchGoogle: vi.fn(async () => [story("Retail media one", "https://one.test/1", "One")]) });
    const first = await run("Retail   Media", deps, 50, "en-IN");
    await flush();
    expect(cache.set).toHaveBeenCalledWith(expect.stringMatching(/^news-search:v1:en-IN:[0-9a-f]{64}$/), expect.any(String), 120);
    const cached = JSON.parse([...store.values()][0]);
    expect(Object.keys(cached)).toEqual(["providers", "results"]);
    expect(cached.results[0]).not.toHaveProperty("inInbox");

    vi.mocked(deps.fetchGoogle).mockClear();
    const second = await run("retail media", deps, 1, "en-IN");
    expect(deps.fetchGoogle).not.toHaveBeenCalled();
    expect(second).toEqual({ query: { normalized: "retail media", warnings: [] }, providers: first.providers, results: first.results.slice(0, 1) });
    await run("retail media", deps, 50, "en-GB");
    expect(deps.fetchGoogle).toHaveBeenCalledTimes(1);

    const partial = memoryCache();
    await run("retail media", makeDeps({ cache: partial.cache, fetchGoogle: vi.fn(async () => { throw new Error("down"); }) }));
    await flush();
    expect(partial.cache.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 30);

    const failed = memoryCache();
    const boom = vi.fn(async () => { throw new Error("down"); });
    await run("retail media", makeDeps({ cache: failed.cache, searchPool: boom, fetchGoogle: boom, fetchBing: boom }));
    await flush();
    expect(failed.cache.set).not.toHaveBeenCalled();
  });

  it("ignores a cache that errors or holds junk", async () => {
    const deps = makeDeps({ cache: { get: vi.fn(async () => "not json"), set: vi.fn(async () => { throw new Error("redis down"); }) } });
    expect((await run("retail", deps)).providers).toEqual({ pool: "ok", google: "ok", bing: "ok" });
    const throwing = makeDeps({ cache: { get: vi.fn(async () => { throw new Error("redis down"); }), set: vi.fn() } });
    expect((await run("retail", throwing)).providers.pool).toBe("ok");
  });
});
