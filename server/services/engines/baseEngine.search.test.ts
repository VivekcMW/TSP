import Parser from "rss-parser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planSearchQueries, type SearchQueryState } from "@shared/search-query-plan";
import { normalizeKeywords, type KeywordInput } from "@shared/profile-preferences";
import type { UserProfile } from "@shared/schema";
import type { TenantScope } from "../../storage";
import type { CrawlOptions } from "../crawlerFetch";
import { installInboxRefreshFixture } from "../../../test/inbox-refresh-fixture";
import { inboxRefreshMessage } from "@shared/inbox-refresh";

const { storage, crawl, network, resolveSources } = vi.hoisted(() => ({
  storage: { beginInboxRefresh: vi.fn(), commitInboxRefresh: vi.fn(), reserveSearchQueryPlan: vi.fn(), getUserSources: vi.fn(), updateUserSource: vi.fn(), getInboxItemByUrl: vi.fn(), createInboxItem: vi.fn() },
  crawl: vi.fn(), network: vi.fn(() => { throw new Error("Unexpected network request"); }), resolveSources: vi.fn(),
}));
vi.mock("../../storage", () => ({ storage }));
vi.mock("../../db", () => { throw new Error("Database must not load in search integration tests"); });
vi.mock("../publicationSources", () => ({ resolvePublicationSources: resolveSources }));
vi.mock("../crawlerFetch", async original => ({ ...await original<typeof import("../crawlerFetch")>(), fetchPublicText: crawl }));
vi.mock("node-fetch", () => ({ default: network }));

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

  it("cycles beyond eight and balances all three groups across new engine instances", async () => {
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
      expect([...counts].sort()).toEqual([2, 3, 3]);
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
    await expect(engine.search()).rejects.toThrow("Article search could not complete");
    expect(fetchedQueries()).toEqual(firstPlan.queries);
    crawl.mockClear(); crawl.mockImplementation(async url => response(url));
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
    if (failure === "all") await expect(engine.search()).rejects.toThrow("Article search could not complete");
    else await expect(engine.search()).resolves.toHaveLength(1);
    expect(crawl).toHaveBeenCalledTimes(2);
    const failedQueries = fetchedQueries();
    crawl.mockClear(); crawl.mockImplementation(async url => response(url));
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