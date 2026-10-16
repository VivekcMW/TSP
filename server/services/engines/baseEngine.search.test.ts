import Parser from "rss-parser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planSearchQueries, type SearchQueryState } from "@shared/search-query-plan";
import { normalizeKeywords, type KeywordInput } from "@shared/profile-preferences";
import type { UserProfile } from "@shared/schema";
import type { TenantScope } from "../../storage";
import type { CrawlOptions } from "../crawlerFetch";
import { installInboxRefreshFixture } from "../../../test/inbox-refresh-fixture";
import { inboxRefreshMessage } from "@shared/inbox-refresh";

const { storage, crawl, network, resolveSources, bing, index, discovery } = vi.hoisted(() => ({
  storage: { beginInboxRefresh: vi.fn(), commitInboxRefresh: vi.fn(), reserveSearchQueryPlan: vi.fn(), getUserSources: vi.fn(), updateUserSource: vi.fn(), getInboxItemByUrl: vi.fn(), createInboxItem: vi.fn() },
  crawl: vi.fn(), network: vi.fn(() => { throw new Error("Unexpected network request"); }), resolveSources: vi.fn(),
  bing: vi.fn(),
  index: { query: vi.fn(), register: vi.fn(), prefetch: vi.fn(), unreadable: vi.fn() },
  discovery: { sites: vi.fn(), terms: vi.fn() },
}));
vi.mock("../../storage", () => ({ storage }));
vi.mock("../../db", () => { throw new Error("Database must not load in search integration tests"); });
vi.mock("../publicationSources", () => ({ resolvePublicationSources: resolveSources }));
vi.mock("../crawlerFetch", async original => ({ ...await original<typeof import("../crawlerFetch")>(), fetchPublicText: crawl }));
vi.mock("node-fetch", () => ({ default: network }));
// Bing is its own provider (see bingNewsSearch.test.ts); here it finds nothing unless a test says so.
vi.mock("../bingNewsSearch", () => ({ fetchBingArticlesForQuery: bing }));
// The shared article index (see articlePool.storage.test.ts); empty unless a test says so.
vi.mock("../articlePool", () => ({ queryArticlePool: index.query, registerPublications: index.register, prefetchPooledBodies: index.prefetch, knownUnreadableLinks: index.unreadable }));
vi.mock("../indexDiscovery", () => ({ noteDiscoveredSites: discovery.sites, noteWatchTerms: discovery.terms }));

// Real engine, provider, parser, planner and article cache; only storage and
// outbound crawl are fixtures. State belongs to storage, not the engine instance.
const scope = { tenantId: "tenant", userId: "user" };
const profiles = new Map<string, UserProfile>();
const states = new Map<string, SearchQueryState>();
const scopeKey = (target: TenantScope) => JSON.stringify([target.tenantId, target.userId]);
type ProfileFixture = Omit<Partial<UserProfile>, "keywords"> & { keywords?: KeywordInput[] };
const profile = (values: ProfileFixture = {}) => ({
  companies: [], influencers: [], publications: [], searchEdition: "en-US", ...values,
  keywords: normalizeKeywords(values.keywords ?? []),
}) as UserProfile;
const save = (values: ProfileFixture, target = scope) => profiles.set(scopeKey(target), profile(values));
const labels = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${String(i).padStart(2, "0")}`);
const xml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const response = (rawUrl: string) => {
  const url = new URL(rawUrl);
  const query = url.searchParams.get("q")!;
  const id = encodeURIComponent(`${url.searchParams.get("ceid")}:${query}`);
  return { text: `<rss version="2.0"><channel><title>News</title><item>
    <title>${xml(query)}</title><link>https://news.test/${id}</link>
    <source url="https://publisher.test">Publisher</source><description>${xml(query)}</description>
    <pubDate>Fri, 18 Sep 2026 12:00:00 GMT</pubDate>
    <userSourceProvenance>active-user-source</userSourceProvenance>
    </item></channel></rss>` };
};
const fetchedQueries = () => crawl.mock.calls.map(([url]) => new URL(url).searchParams.get("q"));
async function makeEngine() {
  const { BaseIndustryEngine } = await import("./baseEngine");
  return new class extends BaseIndustryEngine {
    readonly config = { industry: "other" as const, displayName: "Search test", description: "", industryPrompt: "" };
    async search(target = scope) { return this.fetchKeywordSearchArticles(await this.reserveSearch(target)); }
  }();
}

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  installInboxRefreshFixture(storage);
  profiles.clear(); states.clear(); save({});
  vi.stubGlobal("fetch", network);
  vi.spyOn(Parser.prototype, "parseURL").mockImplementation(() => { throw new Error("Direct parser networking is forbidden"); });
  vi.spyOn(console, "error").mockImplementation(() => {});
  resolveSources.mockResolvedValue([]);
  storage.reserveSearchQueryPlan.mockImplementation(async (target: TenantScope) => {
    const key = scopeKey(target);
    const persisted = profiles.get(key);
    if (!persisted) throw new Error("Profile not found");
    const plan = planSearchQueries(persisted, states.get(key));
    states.set(key, plan.state);
    return { queries: plan.queries, searchEdition: persisted.searchEdition, profile: structuredClone(persisted) };
  });
  storage.getUserSources.mockResolvedValue([]);
  storage.updateUserSource.mockResolvedValue(undefined);
  storage.getInboxItemByUrl.mockResolvedValue(undefined);
  storage.createInboxItem.mockResolvedValue({ id: "inbox-item" });
  crawl.mockImplementation(async url => response(url));
  bing.mockResolvedValue([]);
  index.query.mockResolvedValue([]); index.register.mockResolvedValue(0); index.prefetch.mockResolvedValue(0); index.unreadable.mockResolvedValue([]);
  discovery.sites.mockResolvedValue(0); discovery.terms.mockResolvedValue(undefined);
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled();
  expect(Parser.prototype.parseURL).not.toHaveBeenCalled();
  if (vi.isFakeTimers()) expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("engine durable search integration", () => {
  it("reserves with scope and uses persisted interests/edition instead of the process snapshot", async () => {
    save({ keywords: ["Current"], searchEdition: "hi-IN" });
    const result = await (await makeEngine()).processForUser(scope, profile({ keywords: ["Stale"], searchEdition: "fr-FR" }));
    expect(storage.reserveSearchQueryPlan).toHaveBeenCalledExactlyOnceWith(scope);
    expect(fetchedQueries()).toEqual(["Current"]);
    expect(Object.fromEntries(new URL(crawl.mock.calls[0][0]).searchParams))
      .toEqual({ q: "Current", hl: "hi", gl: "IN", ceid: "IN:hi" });
    expect(result).toMatchObject({ success: true, articlesProcessed: 1, articlesMatched: 1, newInboxItems: 1 });
    expect(resolveSources).toHaveBeenCalledExactlyOnceWith(scope, profiles.get(scopeKey(scope)));
    expect(storage.createInboxItem).toHaveBeenCalledWith(scope, expect.objectContaining({ matchedKeywords: ["Current"] }));
  });

  it("cycles beyond eight, gives topics half, and covers all three groups across new engine instances", async () => {
    const keywords = labels("k", 12), companies = labels("c", 12), influencers = labels("i", 12);
    save({ keywords, companies, influencers });
    const seen = new Set<string | null>();
    const firstDispatched = new Set<string | null>();
    // Sliding windows guarantee first-slot coverage in G*n refreshes, even
    // when a deadline allows only one query to start in each reservation.
    const coverageBound = 3 * keywords.length;
    for (let run = 0; run < coverageBound; run++) {
      crawl.mockClear();
      const expected = planSearchQueries(profiles.get(scopeKey(scope))!, states.get(scopeKey(scope)));
      await (await makeEngine()).search();
      const queries = fetchedQueries();
      expect(queries).toHaveLength(8);
      expect(new Set(queries).size).toBe(8);
      const counts = ["k", "c", "i"].map(prefix => queries.filter(q => q!.startsWith(prefix)).length);
      expect(counts).toEqual([4, 2, 2]);
      expect(queries).toEqual(expected.queries);
      queries.forEach(q => seen.add(q));
      firstDispatched.add(queries[0]);
    }
    expect([...seen].sort()).toEqual([...keywords, ...companies, ...influencers].sort());
    expect([...firstDispatched].sort()).toEqual([...keywords, ...companies, ...influencers].sort());
    expect(storage.reserveSearchQueryPlan).toHaveBeenCalledTimes(coverageBound);
  });

  it("skips zero weights, deduplicates signals and never searches an empty plan", async () => {
    const engine = await makeEngine();
    save({ keywords: [{ keyword: "Disabled", weight: 0 }] });
    expect(await engine.search()).toEqual([]);
    expect(crawl).not.toHaveBeenCalled();
    save({ keywords: ["AI", { keyword: "Disabled", weight: 0 }], companies: ["ai", "Company"], influencers: ["Company", "Person"] });
    const expected = planSearchQueries(profiles.get(scopeKey(scope))!, states.get(scopeKey(scope))).queries;
    await engine.search();
    expect(fetchedQueries()).toEqual(expected);
    expect(storage.reserveSearchQueryPlan).toHaveBeenCalledTimes(2);
  });

  it("keeps reservation state isolated by both tenant and user", async () => {
    const otherUser = { ...scope, userId: "other-user" };
    const otherTenant = { ...scope, tenantId: "other-tenant" };
    for (const target of [scope, otherUser, otherTenant]) save({ keywords: labels("k", 10) }, target);
    const engine = await makeEngine();
    await engine.search(); await engine.search();
    const advanced = structuredClone(states.get(scopeKey(scope)));
    for (const target of [otherUser, otherTenant]) {
      const articles = await engine.search(target);
      expect(articles.map(a => a.categories[0])).toEqual(planSearchQueries(profiles.get(scopeKey(target))!).queries);
      expect(states.get(scopeKey(target))).toEqual(planSearchQueries(profiles.get(scopeKey(target))!).state);
    }
    expect(states.get(scopeKey(scope))).toEqual(advanced);
    expect(storage.reserveSearchQueryPlan.mock.calls).toEqual([[scope], [scope], [otherUser], [otherTenant]]);
  });

  it("reserves on cache hits and isolates identical query arrays by edition", async () => {
    const engine = await makeEngine();
    save({ keywords: ["AI"] });
    const us = await engine.search();
    const firstState = structuredClone(states.get(scopeKey(scope)));
    expect(await engine.search()).toEqual(us);
    expect(crawl).toHaveBeenCalledTimes(1);
    expect(states.get(scopeKey(scope))).toEqual(planSearchQueries(profiles.get(scopeKey(scope))!, firstState).state);
    save({ keywords: ["AI"], searchEdition: "fr-FR" });
    const fr = await engine.search();
    expect(fr[0].link).not.toBe(us[0].link);
    expect(crawl).toHaveBeenCalledTimes(2);
    save({ keywords: ["AI"] });
    expect(await engine.search()).toEqual(us);
    expect(crawl).toHaveBeenCalledTimes(2);
    expect(storage.reserveSearchQueryPlan).toHaveBeenCalledTimes(4);
  });

  it("does not collide query arrays containing pipes, quotes or backslashes", async () => {
    const engine = await makeEngine();
    for (const keywords of [["a|b", "c"], ["a", "b|c"], ['a"b', 'c\\d']]) {
      save({ keywords });
      const articles = await engine.search();
      expect(articles.map(a => a.categories[0])).toEqual(planSearchQueries({ keywords }).queries);
    }
    expect(crawl).toHaveBeenCalledTimes(6);
  });

  it("never attaches active-source provenance to parsed provider results", async () => {
    save({ keywords: ["user-source"] });
    const engine = await makeEngine();
    const articles = await engine.search();
    expect(articles).toHaveLength(1);
    expect(Object.keys(articles[0]).sort()).toEqual(["title", "link", "pubDate", "source", "content", "categories", "publishedAt", "publicationDate", "inputKind", "sourceOrigin"].sort());
    expect(articles[0]).toMatchObject({ publishedAt: "2026-09-18T12:00:00.000Z", inputKind: "provider_excerpt", sourceOrigin: "https://publisher.test",
      publicationDate: { quality: "valid", precision: "instant", publicationDateSource: "rss-pubDate" } });
    expect(articles[0]).not.toHaveProperty("userSourceProvenance");
    expect(await engine.scoreArticles(articles, profile())).toEqual([]);
  });

  it("consumes failed queries so later selections are reached on the next refresh", async () => {
    save({ keywords: labels("k", 10) });
    const engine = await makeEngine();
    const firstPlan = planSearchQueries(profiles.get(scopeKey(scope))!);
    crawl.mockRejectedValue(new Error("unsafe query text"));
    bing.mockRejectedValue(new Error("unsafe query text"));
    await expect(engine.search()).rejects.toThrow("Article search could not complete");
    expect(fetchedQueries()).toEqual(firstPlan.queries);
    crawl.mockClear(); crawl.mockImplementation(async url => response(url)); bing.mockResolvedValue([]);
    const articles = await (await makeEngine()).search();
    expect(fetchedQueries()).toEqual(planSearchQueries(profiles.get(scopeKey(scope))!, firstPlan.state).queries);
    expect(articles).toHaveLength(8);
    expect(vi.mocked(console.error).mock.calls).toEqual(Array.from({ length: 8 }, () => ["[keywordSearch] Search request failed or was cancelled."]));
  });

  it("fails closed on reservation failure without a first-eight fallback or raw query errors", async () => {
    storage.reserveSearchQueryPlan.mockRejectedValue(new Error("private query and driver values"));
    const result = await (await makeEngine()).processForUser(scope, profile({ keywords: ["AI"] }));
    expect(result).toMatchObject({ success: false, articlesProcessed: 0, articlesMatched: 0, newInboxItems: 0,
      errors: [inboxRefreshMessage("failure")] });
    expect(storage.commitInboxRefresh).not.toHaveBeenCalled();
    expect(crawl).not.toHaveBeenCalled();
    expect(storage.getUserSources).not.toHaveBeenCalled();
    expect(resolveSources).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private query");
  });

  it.each([undefined, { queries: [], searchEdition: "en-US" }, { queries: [], searchEdition: "en-US", profile: null }])(
    "rejects a missing reserved profile before any source work (%#)", async reservation => {
      storage.reserveSearchQueryPlan.mockResolvedValue(reservation);
      const result = await (await makeEngine()).processForUser(scope, profile({ keywords: ["Stale"] }));
      expect(result).toMatchObject({ success: false, errors: [inboxRefreshMessage("failure")] });
      expect(storage.commitInboxRefresh).not.toHaveBeenCalled();
      expect(resolveSources).not.toHaveBeenCalled();
      expect(storage.getUserSources).not.toHaveBeenCalled();
      expect(crawl).not.toHaveBeenCalled();
    },
  );

  it("does not start delayed source work while reservation is pending or after it fails", async () => {
    vi.useFakeTimers();
    storage.reserveSearchQueryPlan.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      throw new Error("private profile values");
    });
    storage.getUserSources.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return [];
    });
    const task = (await makeEngine()).processForUser(scope, profile());
    await vi.advanceTimersByTimeAsync(9);
    expect(storage.getUserSources).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect((await task).success).toBe(false);
    expect(storage.getUserSources).not.toHaveBeenCalled();
    expect(resolveSources).not.toHaveBeenCalled();
    expect(crawl).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["all", "mixed"])("does not cache %s failures and immediately recovers on the same key", async failure => {
    save({ keywords: ["AI", "Cloud"] });
    const engine = await makeEngine();
    crawl.mockImplementation(async url => {
      if (failure === "all" || new URL(url).searchParams.get("q") === "Cloud") throw new Error("private provider failure");
      return response(url);
    });
    if (failure === "all") bing.mockRejectedValue(new Error("private provider failure"));
    if (failure === "all") await expect(engine.search()).rejects.toThrow("Article search could not complete");
    else await expect(engine.search()).resolves.toHaveLength(1);
    expect(crawl).toHaveBeenCalledTimes(2);
    const failedQueries = fetchedQueries();
    crawl.mockClear(); crawl.mockImplementation(async url => response(url)); bing.mockResolvedValue([]);
    // The planner fairly rotates even short plans; explicitly repeat this key.
    states.delete(scopeKey(scope));
    expect(await engine.search()).toHaveLength(2);
    expect(fetchedQueries()).toEqual(failedQueries);
    states.delete(scopeKey(scope));
    expect(await engine.search()).toHaveLength(2);
    expect(crawl).toHaveBeenCalledTimes(2);
  });

  it("caches a successfully parsed empty feed, not a failed search", async () => {
    save({ keywords: ["AI"] });
    const engine = await makeEngine();
    crawl.mockResolvedValue({ text: '<rss version="2.0"><channel><title>News</title></channel></rss>' });
    expect(await engine.search()).toEqual([]);
    expect(await engine.search()).toEqual([]);
    expect(crawl).toHaveBeenCalledTimes(1);
    expect(storage.reserveSearchQueryPlan).toHaveBeenCalledTimes(2);
  });

  it("reports search-only failure instead of a successful empty run", async () => {
    save({ keywords: ["AI"] });
    crawl.mockRejectedValue(new Error("private provider details"));
    bing.mockRejectedValue(new Error("private provider details"));
    const result = await (await makeEngine()).processForUser(scope, profile());
    expect(result).toMatchObject({ success: false, outcome: "failure", articlesProcessed: 0,
      errors: [inboxRefreshMessage("failure")] });
    expect(storage.commitInboxRefresh).not.toHaveBeenCalled();
    expect(storage.createInboxItem).not.toHaveBeenCalled();
  });

  it.each([false, true])("awaits the delayed source sibling after search failure (source also fails: %s)", async sourceFails => {
    vi.useFakeTimers();
    save({ keywords: ["AI"] });
    storage.getUserSources.mockResolvedValue([{ id: "own", name: "Own source", feedUrl: "https://own.test/feed", isActive: true }]);
    let sourceSettled = false, returned = false;
    bing.mockRejectedValue(new Error("private search failure"));
    crawl.mockImplementation(async (url: string) => {
      if (new URL(url).hostname !== "own.test") throw new Error("private search failure");
      await new Promise(resolve => setTimeout(resolve, 100));
      sourceSettled = true;
      if (sourceFails) throw new Error("private source failure");
      return { text: JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: [
        { title: "AI report", url: "https://own.test/story", content_text: "AI research" },
      ] }) };
    });
    const task = (await makeEngine()).processForUser(scope, profile()).then(result => { returned = true; return result; });
    await vi.advanceTimersByTimeAsync(99);
    expect(returned).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await task;
    expect(sourceSettled).toBe(true);
    if (sourceFails) {
      expect(result).toMatchObject({ success: false, outcome: "failure", newInboxItems: 0, replacedCount: 0 });
      expect(result.errors).toEqual([inboxRefreshMessage("failure")]);
      expect(storage.commitInboxRefresh).not.toHaveBeenCalled();
      expect(storage.createInboxItem).not.toHaveBeenCalled();
    } else {
      expect(result).toMatchObject({ success: true, outcome: "updated", newInboxItems: 1, replacedCount: 0 });
      expect(storage.commitInboxRefresh).toHaveBeenCalled();
    }
    expect(JSON.stringify(result.errors ?? [])).not.toContain("private");
    expect(storage.updateUserSource).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps finished search results when the budget runs out, so a refresh without active sources still succeeds", async () => {
    vi.useFakeTimers();
    save({ keywords: labels("k", 12) });
    storage.getUserSources.mockResolvedValue([]);
    let calls = 0;
    crawl.mockImplementation(async (url: string, options: CrawlOptions) => {
      // The first two queries answer quickly; the rest are slower than the whole budget.
      if (++calls <= 2) return response(url);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 30_000);
        options.signal!.addEventListener("abort", () => { clearTimeout(timer); reject(options.signal!.reason); }, { once: true });
      });
      return response(url);
    });
    const task = (await makeEngine()).processForUser(scope, profile());
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await task;
    expect(result).toMatchObject({ success: true, articlesProcessed: 2 });
    expect(storage.commitInboxRefresh).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the reserved snapshot throughout even when the profile changes during crawling", async () => {
    save({ keywords: ["Current"], publications: ["Current publication"] });
    const reserved = structuredClone(profiles.get(scopeKey(scope))!);
    crawl.mockImplementation(async url => {
      save({ keywords: ["Edited again"], publications: ["Later publication"] });
      return response(url);
    });
    const engine = await makeEngine();
    const scorer = vi.spyOn(engine, "scoreArticles");
    const result = await engine.processForUser(scope, profile({ keywords: ["Stale"] }));
    expect(result).toMatchObject({ success: true, articlesMatched: 1, newInboxItems: 1 });
    expect(resolveSources).toHaveBeenCalledExactlyOnceWith(scope, reserved);
    expect(scorer.mock.calls[0][1]).toEqual(reserved);
    expect(storage.reserveSearchQueryPlan).toHaveBeenCalledExactlyOnceWith(scope);
  });

  it.each([false, true])("derives setup guidance from the reserved profile, not the caller (current signals: %s)", async hasSignals => {
    save({ publications: hasSignals ? ["Current publication"] : [] });
    const result = await (await makeEngine()).processForUser(scope,
      profile({ publications: hasSignals ? [] : ["Stale publication"] }));
    expect(result).toMatchObject({ success: true, needsSetup: !hasSignals });
    expect(crawl).not.toHaveBeenCalled();
  });

  it("bounds workers to two, stops at 20s, keeps finished queries (uncached) and awaits all started work", async () => {
    vi.useFakeTimers();
    save({ keywords: labels("k", 12) });
    const engine = await makeEngine();
    const firstPlan = planSearchQueries(profiles.get(scopeKey(scope))!);
    let active = 0, maximum = 0, settled = 0, aborted = 0;
    crawl.mockImplementation(async (url: string, options: CrawlOptions) => {
      expect(options.timeoutMs).toBe(8000);
      const signal = options.signal!;
      active++; maximum = Math.max(maximum, active);
      try {
        await new Promise<void>((resolve, reject) => {
          const abort = () => { aborted++; clearTimeout(timer); reject(signal.reason); };
          const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 8000);
          signal.addEventListener("abort", abort, { once: true });
        });
        return response(url);
      } finally { active--; settled++; }
    });
    const task = engine.search();
    await vi.advanceTimersByTimeAsync(19999);
    expect(crawl).toHaveBeenCalledTimes(6);
    expect(active).toBe(2); expect(settled).toBe(4);
    await vi.advanceTimersByTimeAsync(1);
    // The four queries that finished before the deadline are kept.
    expect((await task).map(article => article.categories?.[0])).toEqual(firstPlan.queries.slice(0, 4));
    expect(maximum).toBe(2); expect(active).toBe(0); expect(settled).toBe(6); expect(aborted).toBe(2);
    expect(fetchedQueries()).toEqual(firstPlan.queries.slice(0, 6));
    expect(states.get(scopeKey(scope))).toEqual(firstPlan.state);
    expect(vi.getTimerCount()).toBe(0);
    // Cancelled/unstarted allocations were consumed too; do not restart at k00.
    crawl.mockClear(); crawl.mockImplementation(async url => response(url));
    await engine.search();
    expect(fetchedQueries()).toEqual(planSearchQueries(profiles.get(scopeKey(scope))!, firstPlan.state).queries);
    expect(storage.reserveSearchQueryPlan).toHaveBeenCalledTimes(2);
    // Reset only the fixture's planner cursor to request the exact expired key.
    states.delete(scopeKey(scope));
    crawl.mockClear();
    expect(await engine.search()).toHaveLength(firstPlan.queries.length);
    expect(fetchedQueries()).toEqual(firstPlan.queries);
  });

  it("shares concurrent same-key fetches while reserving every refresh", async () => {
    vi.useFakeTimers();
    save({ keywords: ["AI"] });
    const engine = await makeEngine();
    crawl.mockImplementation(async url => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return response(url);
    });
    const tasks = Promise.all([engine.search(), engine.search()]);
    await vi.advanceTimersByTimeAsync(10);
    const [first, second] = await tasks;
    expect(first).toEqual(second); expect(first).toHaveLength(1);
    expect(crawl).toHaveBeenCalledTimes(1);
    expect(storage.reserveSearchQueryPlan).toHaveBeenCalledTimes(2);
  });
});

describe("Bing News next to Google News", () => {
  const bingStory = (query: string) => ({
    title: `Bing ${query}`, link: `https://bing-publisher.test/${encodeURIComponent(query)}`, source: "Bing Publisher",
    sourceOrigin: "https://bing-publisher.test", content: query, categories: [query], inputKind: "provider_excerpt" as const,
    pubDate: "2026-09-18T12:00:00.000Z", publishedAt: "2026-09-18T12:00:00.000Z",
  });

  it("asks Bing the same queries in the same edition, and keeps both providers' stories", async () => {
    save({ keywords: ["Current"], searchEdition: "en-IN" });
    bing.mockImplementation(async (query: string) => [bingStory(query)]);
    const articles = await (await makeEngine()).search();
    expect(bing).toHaveBeenCalledExactlyOnceWith("Current", 8, "en-IN", expect.any(AbortSignal));
    expect(articles.map(article => article.link).sort()).toEqual(["https://bing-publisher.test/Current", "https://news.test/IN%3Aen%3ACurrent"]);
  });

  it("keeps Bing's stories when every Google search fails", async () => {
    save({ keywords: labels("k", 3) });
    crawl.mockRejectedValue(new Error("throttled"));
    bing.mockImplementation(async (query: string) => [bingStory(query)]);
    const articles = await (await makeEngine()).search();
    expect(articles.map(article => article.title)).toEqual(["Bing k00", "Bing k01", "Bing k02"]);
  });

  it("keeps Google's stories when Bing fails", async () => {
    save({ keywords: labels("k", 2) });
    bing.mockRejectedValue(new Error("Bing down"));
    const articles = await (await makeEngine()).search();
    expect(articles.map(article => article.title)).toEqual(["k00", "k01"]);
  });

  it("doesn't let slow Google searches hold Bing's stories past the time budget", async () => {
    vi.useFakeTimers();
    save({ keywords: labels("k", 3) });
    crawl.mockImplementation((_url: string, { signal }: CrawlOptions) =>
      new Promise((_, reject) => signal!.addEventListener("abort", () => reject(signal!.reason), { once: true })));
    bing.mockImplementation(async (query: string) => [bingStory(query)]);
    const pending = (await makeEngine()).search();
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await pending).map(article => article.title)).toEqual(["Bing k00", "Bing k01", "Bing k02"]);
  });
});

describe("shared article index", () => {
  const indexed = (title: string, link: string) => ({
    title, link, source: "Index Weekly", sourceOrigin: new URL(link).origin, content: `${title} developments in full, as fetched by the crawler.`,
    categories: [], pubDate: "2026-09-18T12:00:00.000Z", publishedAt: "2026-09-18T12:00:00.000Z", inputKind: "page_body" as const,
  });

  it("adds the index's recent stories to the candidates and scores them like any other", async () => {
    save({ keywords: ["Current"] });
    index.query.mockResolvedValue([indexed("Current, from the index", "https://index.test/current"), indexed("Unrelated", "https://index.test/other")]);
    const result = await (await makeEngine()).processForUser(scope, profile());
    expect(index.query).toHaveBeenCalledExactlyOnceWith(profiles.get(scopeKey(scope)), { days: 30, limit: 150 });
    expect(result).toMatchObject({ success: true, articlesProcessed: 3, articlesMatched: 2, newInboxItems: 2 });
    expect(storage.createInboxItem.mock.calls.map(([, item]) => item.articleUrl).sort()).toEqual(["https://index.test/current", "https://news.test/US%3Aen%3ACurrent"]);
  });

  it("never fails a refresh because the index is unavailable", async () => {
    save({ keywords: ["Current"] });
    index.query.mockRejectedValue(new Error("index down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await (await makeEngine()).processForUser(scope, profile());
    expect(result).toMatchObject({ success: true, newInboxItems: 1 });
  });

  it("registers the person's active sources in the catalogue", async () => {
    save({ keywords: ["Current"] });
    storage.getUserSources.mockResolvedValue([
      { id: "own", name: "Own source", feedUrl: "https://own.test/feed", sourceType: "feed", isActive: true },
      { id: "old", name: "Old source", feedUrl: "https://old.test/feed", sourceType: "feed", isActive: false },
    ]);
    crawl.mockImplementation(async (url: string) => new URL(url).hostname === "own.test"
      ? { text: JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: [{ title: "Current report", url: "https://own.test/story", content_text: "Current research" }] }) }
      : response(url));
    await (await makeEngine()).processForUser(scope, profile());
    expect(index.register).toHaveBeenCalledExactlyOnceWith([{ name: "Own source", feedUrl: "https://own.test/feed", sourceType: "feed" }]);
  });

  it("reads the accepted stories' pages right after the commit, so writing needs no live fetch", async () => {
    save({ keywords: ["Current"] });
    storage.createInboxItem.mockImplementation(async (_scope: TenantScope, item: Record<string, unknown>) => ({ id: "inbox-item", ...item }));
    await (await makeEngine()).processForUser(scope, profile());
    // Once before offering (the read check), once after the commit for whatever was accepted.
    expect(index.prefetch).toHaveBeenCalledTimes(2);
    expect(index.prefetch).toHaveBeenLastCalledWith(
      [expect.objectContaining({ link: "https://news.test/US%3Aen%3ACurrent", title: "Current", source: "Publisher" })],
      expect.objectContaining({ limit: 10 }));
  });
});

describe("shared index discovery", () => {
  const indexed = (title: string, link: string) => ({
    title, link, source: "Index Weekly", sourceOrigin: new URL(link).origin, content: `${title}: Current developments in full.`,
    categories: [], pubDate: "2026-09-18T12:00:00.000Z", publishedAt: "2026-09-18T12:00:00.000Z", inputKind: "page_body" as const,
  });

  it("remembers the publishers behind search results and the person's terms, for discovery", async () => {
    save({ keywords: ["Current"], companies: ["Acme"] });
    await (await makeEngine()).processForUser(scope, profile());
    expect(discovery.sites).toHaveBeenCalledExactlyOnceWith(["https://publisher.test", "https://publisher.test"], "search");
    expect(discovery.terms).toHaveBeenCalledExactlyOnceWith(profiles.get(scopeKey(scope)));
  });

  it("leaves out stories the crawler has found unreadable", async () => {
    save({ keywords: ["Current"] });
    index.unreadable.mockResolvedValue(["https://news.test/US%3Aen%3ACurrent"]);
    const result = await (await makeEngine()).processForUser(scope, profile());
    expect(index.unreadable).toHaveBeenCalledWith(["https://news.test/US%3Aen%3ACurrent"]);
    expect(result).toMatchObject({ success: true, articlesProcessed: 0, newInboxItems: 0 });
    expect(storage.createInboxItem).not.toHaveBeenCalled();
  });

  it("reads the top stories before offering them, and offers only the ones it can write from", async () => {
    // Production: 6 of a new account's 10 stories were pages the crawler couldn't read (blocked,
    // paywalled, JavaScript-only), found seconds after they were offered.
    save({ keywords: ["Current"] });
    index.query.mockResolvedValue([indexed("Current, blocked", "https://blocked.test/current"), indexed("Current, readable", "https://open.test/current")]);
    // Before reading nothing is known; after reading, the blocked page is.
    index.unreadable.mockResolvedValueOnce([]).mockResolvedValue(["https://blocked.test/current"]);
    const result = await (await makeEngine()).processForUser(scope, profile());
    const [stories, options] = index.prefetch.mock.calls[0];
    expect(stories.map((story: { link: string }) => story.link).sort()).toEqual(["https://blocked.test/current", "https://news.test/US%3Aen%3ACurrent", "https://open.test/current"]);
    expect(options).toMatchObject({ limit: 24, concurrency: 6, signal: expect.any(AbortSignal) });
    const saved = storage.createInboxItem.mock.calls.map(([, item]) => item.articleUrl);
    expect(saved).toContain("https://open.test/current");
    expect(saved).not.toContain("https://blocked.test/current");
    expect(result).toMatchObject({ success: true, newInboxItems: 2 });
  });

  it("still offers stories when the read check itself fails", async () => {
    save({ keywords: ["Current"] });
    index.prefetch.mockRejectedValue(new Error("pool down"));
    index.unreadable.mockResolvedValueOnce([]).mockRejectedValue(new Error("pool down"));
    const result = await (await makeEngine()).processForUser(scope, profile());
    expect(result).toMatchObject({ success: true, newInboxItems: 1 });
  });

  it("leaves out video pages, which have no text to write from", async () => {
    save({ keywords: ["Current"] });
    index.query.mockResolvedValue([indexed("Current, the video", "https://index.test/india/video/current-ytvd-1"), indexed("Current, the article", "https://index.test/india/current-1")]);
    await (await makeEngine()).processForUser(scope, profile());
    const saved = storage.createInboxItem.mock.calls.map(([, item]) => item.articleUrl);
    expect(saved).toContain("https://index.test/india/current-1");
    expect(saved).not.toContain("https://index.test/india/video/current-ytvd-1");
  });

  it("skips the search engines once the index alone has enough candidates", async () => {
    save({ keywords: ["Current"] });
    index.query.mockResolvedValue(Array.from({ length: 40 }, (_, i) => indexed(`Current ${i}`, `https://index.test/${i}`)));
    const result = await (await makeEngine()).processForUser(scope, profile());
    expect(crawl).not.toHaveBeenCalled();
    expect(bing).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, articlesProcessed: 40, newInboxItems: 10 });
    expect(discovery.sites).not.toHaveBeenCalled();
  });
});
