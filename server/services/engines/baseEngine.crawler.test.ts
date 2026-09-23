import { Headers } from "node-fetch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicationResolution, UserProfile } from "@shared/schema";
import type { PublicationCandidate } from "@shared/publication-preferences";
import { planSearchQueries } from "@shared/search-query-plan";
import { installInboxRefreshFixture } from "../../../test/inbox-refresh-fixture";
import { inboxRefreshMessage } from "@shared/inbox-refresh";
const { storage, network, discovery } = vi.hoisted(() => ({
  storage: { beginInboxRefresh: vi.fn(), commitInboxRefresh: vi.fn(), reserveSearchQueryPlan: vi.fn(), getUserSources: vi.fn(), updateUserSource: vi.fn(), createUserSource: vi.fn(), getInboxItemByUrl: vi.fn(), createInboxItem: vi.fn(),
    getPublicationResolutions: vi.fn(), claimPublicationResolution: vi.fn(), completePublicationResolution: vi.fn(), finishPublicationResolution: vi.fn() },
  network: vi.fn(), discovery: vi.fn(),
}));
vi.mock("../../storage", () => ({ storage }));
vi.mock("../keywordSearch", () => ({ fetchArticlesForQuery: vi.fn().mockResolvedValue([]) }));
vi.mock("../crawlerFetch", async (original) => ({ ...await original<typeof import("../crawlerFetch")>(), fetchPublicText: network }));
vi.mock("../feedDiscovery", async (original) => ({ ...await original<typeof import("../feedDiscovery")>(), discoverFeed: discovery }));
import { BaseIndustryEngine } from "./baseEngine";
import { CrawlError } from "../crawlerFetch";
class Engine extends BaseIndustryEngine {
  readonly config = { industry: "other" as const, displayName: "Test", description: "", industryPrompt: "" };
  fetchSources() { return this.fetchUserSources(scope); }
}
const scope = { tenantId: "tenant", userId: "user" };
let persistedProfile: UserProfile;
const profile = (publications: string[] = [], publicationCandidates: PublicationCandidate[] = []) =>
  (persistedProfile = { publications, publicationCandidates, keywords: [], companies: [], influencers: [] } as unknown as UserProfile);
const resolutions = new Map<string, PublicationResolution>();
let attempt = 0;
const source = (id: string) => ({ id, name: `Source ${id}`, feedUrl: `https://news.test/${id}`, sourceType: "feed", isActive: true, lastFetchedAt: null });
const feed = (url: string) => ({ url, text: JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: [{ title: "Real article", url: "https://news.test/story", content_text: "Real content" }] }), status: 200, headers: new Headers() });
beforeEach(() => {
  vi.resetAllMocks();
  installInboxRefreshFixture(storage);
  profile();
  storage.reserveSearchQueryPlan.mockImplementation(async () => ({ queries: planSearchQueries(persistedProfile).queries, searchEdition: "en-US", profile: persistedProfile }));
  resolutions.clear(); attempt = 0;
  storage.getPublicationResolutions.mockImplementation(async (_scope, urls: string[]) => urls.flatMap(url => resolutions.has(url) ? [resolutions.get(url)] : []));
  storage.claimPublicationResolution.mockImplementation(async (_scope, url: string) => {
    const previous = resolutions.get(url);
    if (previous?.status === "resolved" || (previous?.leaseUntil && previous.leaseUntil.getTime() > Date.now())) return undefined;
    const token = `claim-${++attempt}`;
    resolutions.set(url, { ...scope, url, status: "checking", claimToken: token, leaseUntil: new Date(Date.now() + 30000),
      lastAttemptAt: new Date(Date.now() + attempt), error: null, sourceId: null, resolvedFeedUrl: null });
    return token;
  });
  storage.finishPublicationResolution.mockImplementation(async (_scope, url: string, token: string, outcome) => {
    const row = resolutions.get(url);
    if (!row || row.claimToken !== token) return false;
    resolutions.set(url, { ...row, ...outcome, claimToken: null, leaseUntil: null });
    return true;
  });
  storage.completePublicationResolution.mockImplementation(async (_scope, url: string, token: string) => {
    const row = resolutions.get(url);
    if (!row || row.claimToken !== token) return false;
    resolutions.set(url, { ...row, status: "resolved", sourceId: "linked-source", claimToken: null, leaseUntil: null });
    return true;
  });
  storage.getUserSources.mockResolvedValue([]); storage.updateUserSource.mockResolvedValue({}); storage.createUserSource.mockResolvedValue({});
  network.mockImplementation(async (url: string) => feed(url)); discovery.mockResolvedValue({ error: "Unresolved" });
});
afterEach(() => vi.useRealTimers());

describe("source refresh reliability", () => {
  it("marks only fetched active rows with trusted provenance and never trusts category/source names", async () => {
    storage.getUserSources.mockResolvedValue([source("active"), { ...source("paused"), isActive: false }]);
    const engine = new Engine();
    const articles = await engine.fetchSources();
    expect(network).toHaveBeenCalledTimes(1);
    expect(articles).toHaveLength(1);
    expect(articles[0].userSourceProvenance).toEqual({ kind: "active-user-source", sourceId: "active" });
    expect((await engine.scoreArticles(articles, profile()))[0]).toMatchObject({ relevanceScore: 0.1, matchedKeywords: [] });
    const { userSourceProvenance: _provenance, ...untrusted } = articles[0];
    expect(await engine.scoreArticles([untrusted], profile([untrusted.source]))).toEqual([]);
  });

  it("marks a successfully scraped active webpage with the same provenance contract", async () => {
    storage.getUserSources.mockResolvedValue([{ ...source("webpage"), sourceType: "webpage" }]);
    const text = "A research team published its detailed findings on regional infrastructure investment and the resulting operational improvements. ".repeat(8);
    network.mockResolvedValue({ ...feed("https://news.test/webpage"), text: `<html><title>Research update</title><article><p>${text}</p></article></html>`, headers: new Headers({ "content-type": "text/html" }) });
    const articles = await new Engine().fetchSources();
    expect(articles).toHaveLength(1);
    expect(articles[0].userSourceProvenance).toEqual({ kind: "active-user-source", sourceId: "webpage" });
  });

  it("materializes only verified built-in names and ignores unknown names", async () => {
    await new Engine().processForUser(scope, profile(["Campaign", "Nielsen Insights", "Marketing Week"]));
    expect(discovery).toHaveBeenCalledTimes(2); expect(storage.createUserSource).not.toHaveBeenCalled();
  });
  it("materializes verified names and explicit URLs, capped at four publications", async () => {
    discovery.mockResolvedValue({ name: "Actual host", feedUrl: "https://news.test/feed", sourceType: "feed" });
    await new Engine().processForUser(scope, profile(["Campaign", ...Array.from({ length: 10 }, (_, i) => `https://news-${i}.test/`)]));
    expect(discovery).toHaveBeenCalledTimes(4); expect(storage.completePublicationResolution).toHaveBeenCalledTimes(4);
    expect(storage.completePublicationResolution).toHaveBeenCalledWith(scope, "https://www.campaignlive.co.uk", "claim-1", { name: "Campaign", feedUrl: "https://news.test/feed", sourceType: "feed" });
    expect(storage.createUserSource).not.toHaveBeenCalled();
  });
  it("does not create sources after the materialization budget expires", async () => {
    vi.useFakeTimers();
    let returned = false;
    discovery.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 7000));
      return { name: "Late", feedUrl: "https://news.test/feed", sourceType: "feed" };
    });
    const task = new Engine().processForUser(scope, profile(["https://news.test/"])).then(result => { returned = true; return result; });
    await vi.advanceTimersByTimeAsync(6000);
    expect(returned).toBe(false);
    expect(storage.commitInboxRefresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000); await task;
    expect(vi.getTimerCount()).toBe(0);
    expect(storage.createUserSource).not.toHaveBeenCalled();
    expect(storage.completePublicationResolution).not.toHaveBeenCalled();
    expect(resolutions.get("https://news.test/")?.status).toBe("failed");
  });
  it("rotates failed attempts past the first four across fresh engine/module instances", async () => {
    const urls = Array.from({ length: 5 }, (_, i) => `https://news-${i}.test/`);
    await new Engine().processForUser(scope, profile(urls));
    expect(discovery.mock.calls.map(([url]) => url)).toEqual(urls.slice(0, 4));
    // Recreate the module as well as the engine; only the storage fixture survives.
    vi.resetModules();
    const { BaseIndustryEngine: FreshBase } = await import("./baseEngine");
    class FreshEngine extends FreshBase { readonly config = new Engine().config; }
    discovery.mockClear();
    await new FreshEngine().processForUser(scope, profile(urls));
    expect(discovery.mock.calls.map(([url]) => url)).toEqual([urls[4], ...urls.slice(0, 3)]);
    discovery.mockClear();
    await new FreshEngine().processForUser(scope, profile(urls));
    expect(discovery.mock.calls[0][0]).toBe(urls[3]);
  });
  it("reaches the fifth URL after four successful resolutions instead of probing tombstones", async () => {
    const urls = Array.from({ length: 5 }, (_, i) => `https://news-${i}.test/`);
    discovery.mockImplementation(async (url: string) => ({ feedUrl: `${url}feed`, sourceType: "feed" }));
    await new Engine().processForUser(scope, profile(urls));
    expect(discovery).toHaveBeenCalledTimes(4);
    discovery.mockClear();
    await new Engine().processForUser(scope, profile(urls));
    expect(discovery).toHaveBeenCalledExactlyOnceWith(urls[4], expect.any(AbortSignal));
    discovery.mockClear();
    await new Engine().processForUser(scope, profile(urls));
    expect(discovery).not.toHaveBeenCalled();
  });
  it("lets only one competing refresh discover and complete the same candidate", async () => {
    vi.useFakeTimers();
    discovery.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return { feedUrl: "https://news.test/feed", sourceType: "feed" };
    });
    const tasks = Promise.all([new Engine().processForUser(scope, profile(["https://news.test/"])),
      new Engine().processForUser(scope, profile(["https://news.test/"]))]);
    await vi.advanceTimersByTimeAsync(10); await tasks;
    expect(discovery).toHaveBeenCalledTimes(1); expect(storage.completePublicationResolution).toHaveBeenCalledTimes(1);
    expect(resolutions.get("https://news.test/")?.status).toBe("resolved");
  });
  it("uses selected metadata first-seen, deduplicates URLs and never trusts source names", async () => {
    storage.getUserSources.mockResolvedValue([{ ...source("old"), name: "Brand", isActive: false }]);
    discovery.mockResolvedValue({ feedUrl: "https://new.test/feed", sourceType: "webpage" });
    await new Engine().processForUser(scope, profile(["Brand", "Alias", "Plain name"], [
      { name: "Brand", url: "https://new.test/" }, { name: "brand", url: "https://wrong.test/" },
      { name: "Alias", url: "https://new.test/" }, { name: "Not selected", url: "https://unselected.test/" },
    ]));
    expect(storage.getPublicationResolutions).toHaveBeenCalledWith(scope, ["https://new.test/"]);
    expect(storage.claimPublicationResolution).toHaveBeenCalledExactlyOnceWith(scope, "https://new.test/");
    expect(discovery).toHaveBeenCalledExactlyOnceWith("https://new.test/", expect.any(AbortSignal));
    expect(storage.completePublicationResolution).toHaveBeenCalledWith(scope, "https://new.test/", "claim-1", {
      name: "Brand", feedUrl: "https://new.test/feed", sourceType: "webpage",
    });
    expect(storage.updateUserSource).not.toHaveBeenCalled();
  });
  it.each([false, true])("does not recreate resolved removed/paused sources (paused=%s)", async paused => {
    const url = "https://news.test/";
    discovery.mockResolvedValue({ feedUrl: "https://news.test/feed", sourceType: "feed" });
    await new Engine().processForUser(scope, profile([url]));
    if (paused) storage.getUserSources.mockResolvedValue([{ ...source("linked-source"), isActive: false }]);
    discovery.mockClear(); storage.claimPublicationResolution.mockClear(); storage.completePublicationResolution.mockClear();
    await new Engine().processForUser(scope, profile([url]));
    expect(discovery).not.toHaveBeenCalled(); expect(storage.claimPublicationResolution).not.toHaveBeenCalled();
    expect(storage.completePublicationResolution).not.toHaveBeenCalled(); expect(storage.updateUserSource).not.toHaveBeenCalled();
  });
  it("keeps exact existing manual feeds on the claim protocol without reactivating them", async () => {
    storage.getUserSources.mockResolvedValue([{ ...source("paused"), feedUrl: "https://news.test/feed", isActive: false }]);
    discovery.mockResolvedValue({ feedUrl: "https://news.test/feed", sourceType: "feed" });
    await new Engine().processForUser(scope, profile(["https://news.test/feed"]));
    expect(storage.claimPublicationResolution).toHaveBeenCalledWith(scope, "https://news.test/feed");
    expect(storage.completePublicationResolution).toHaveBeenCalledWith(scope, "https://news.test/feed", "claim-1", {
      name: "https://news.test/feed", feedUrl: "https://news.test/feed", sourceType: "feed",
    });
    expect(storage.createUserSource).not.toHaveBeenCalled(); expect(storage.updateUserSource).not.toHaveBeenCalled();
  });
  it("never probes when storage denies a claim for a deselected URL or a concurrent lease", async () => {
    storage.claimPublicationResolution.mockResolvedValue(undefined);
    await new Engine().processForUser(scope, profile(["https://news.test/"]));
    expect(discovery).not.toHaveBeenCalled(); expect(storage.completePublicationResolution).not.toHaveBeenCalled();
  });
  it("skips active checking leases and retries expired ones", async () => {
    const urls = ["https://active.test/", "https://expired.test/"];
    for (const url of urls) await storage.claimPublicationResolution(scope, url);
    resolutions.get(urls[1])!.leaseUntil = new Date(0);
    storage.claimPublicationResolution.mockClear();
    await new Engine().processForUser(scope, profile(urls));
    expect(storage.claimPublicationResolution).toHaveBeenCalledExactlyOnceWith(scope, urls[1]);
    expect(discovery).toHaveBeenCalledExactlyOnceWith(urls[1], expect.any(AbortSignal));
  });
  it("claims just before discovery, bounds workers to two and never claims queued URLs after cancellation", async () => {
    vi.useFakeTimers();
    discovery.mockImplementation(async (url: string, signal: AbortSignal) => {
      expect(resolutions.get(url)?.status).toBe("checking");
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
    });
    const task = new Engine().processForUser(scope, profile(Array.from({ length: 6 }, (_, i) => `https://news-${i}.test/`)));
    await vi.advanceTimersByTimeAsync(5999);
    expect(discovery).toHaveBeenCalledTimes(2); expect(storage.claimPublicationResolution).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await task).toMatchObject({ success: true, outcome: "no_new", count: 0, discoveryWarnings: expect.any(Array) });
    expect(storage.claimPublicationResolution).toHaveBeenCalledTimes(2);
    expect(storage.finishPublicationResolution).toHaveBeenCalledTimes(2);
    expect(storage.completePublicationResolution).not.toHaveBeenCalled();
  });
  it("does not discover or complete if cancellation occurs while a claim is pending", async () => {
    vi.useFakeTimers();
    storage.claimPublicationResolution.mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 7000)); return "late-claim"; });
    const task = new Engine().processForUser(scope, profile(["https://news.test/"]));
    await vi.advanceTimersByTimeAsync(7000); await task;
    expect(discovery).not.toHaveBeenCalled(); expect(storage.completePublicationResolution).not.toHaveBeenCalled();
    expect(storage.finishPublicationResolution).toHaveBeenCalledWith(scope, "https://news.test/", "late-claim", expect.objectContaining({ status: "failed" }));
  });
  it.each(["returned", "thrown"])("persists safe discovery failure text (%s) separately from fetch failures", async kind => {
    const unsafe = "https://user:password@10.0.0.1/ <script>secret</script>";
    if (kind === "returned") discovery.mockResolvedValue({ error: unsafe });
    else discovery.mockRejectedValue(new Error(unsafe));
    const result = await new Engine().processForUser(scope, profile(["https://news.test/"]));
    expect(result).toMatchObject({ success: true, outcome: "no_new", count: 0 });
    expect(result.errors).toBeUndefined();
    expect(result.discoveryWarnings).toEqual(["The source could not be read. It may be unavailable or block automated access."]);
    expect(storage.finishPublicationResolution).toHaveBeenCalledWith(scope, "https://news.test/", "claim-1", { status: "failed", error: result.discoveryWarnings![0] });
    expect(storage.completePublicationResolution).not.toHaveBeenCalled();
  });
  it("keeps discovery warnings separate when configured sources fetch successfully", async () => {
    storage.getUserSources.mockResolvedValue([source("readable")]);
    storage.getInboxItemByUrl.mockResolvedValue({ id: "existing-item" });
    const result = await new Engine().processForUser(scope, profile(["https://unavailable.test/"]));
    expect(result.articlesProcessed).toBe(1);
    expect(result.success).toBe(true); expect(result.discoveryWarnings).toHaveLength(1);
    expect(result.errors).toBeUndefined();
    expect(storage.finishPublicationResolution).toHaveBeenCalledWith(scope, "https://unavailable.test/", "claim-1", {
      status: "failed", error: result.discoveryWarnings![0],
    });
  });
  it.each(["getPublicationResolutions", "claimPublicationResolution", "completePublicationResolution", "finishPublicationResolution"] as const)("surfaces %s persistence failure instead of returning success", async method => {
    if (method === "completePublicationResolution") discovery.mockResolvedValue({ feedUrl: "https://news.test/feed", sourceType: "feed" });
    storage[method].mockRejectedValue(new Error("Persistence unavailable"));
    const result = await new Engine().processForUser(scope, profile(["https://news.test/"]));
    expect(result.success).toBe(false); expect(result.errors?.length).toBeGreaterThan(0);
    if (method === "completePublicationResolution") expect(storage.finishPublicationResolution).not.toHaveBeenCalled();
  });
  it("reports a fenced completion without falling back to direct source writes", async () => {
    discovery.mockResolvedValue({ feedUrl: "https://news.test/feed", sourceType: "feed" });
    storage.completePublicationResolution.mockResolvedValue(false);
    const result = await new Engine().processForUser(scope, profile(["https://news.test/"]));
    expect(result.success).toBe(true); expect(result.discoveryWarnings?.[0]).toContain("lease expired");
    expect(storage.createUserSource).not.toHaveBeenCalled(); expect(storage.updateUserSource).not.toHaveBeenCalled();
  });
  it("records failed sources while retaining usable source results", async () => {
    storage.getUserSources.mockResolvedValue([source("blocked"), source("good")]);
    network.mockImplementation(async (url: string) => {
      if (url.endsWith("blocked")) throw new CrawlError("http", "The source returned HTTP 403.");
      return feed(url);
    });
    await expect(new Engine().fetchSources()).resolves.toHaveLength(1);
    expect(storage.updateUserSource).toHaveBeenCalledWith(scope, "blocked", expect.objectContaining({ lastFetchStatus: "error", lastFetchError: "The source returned HTTP 403." }));
    expect(storage.updateUserSource).toHaveBeenCalledWith(scope, "good", expect.objectContaining({ lastFetchStatus: "ok", lastFetchError: null }));
  });
  it("reports all-failed runs as failed rather than an empty success", async () => {
    storage.getUserSources.mockResolvedValue([source("bad")]); network.mockRejectedValue(new CrawlError("network", "Unavailable"));
    const result = await new Engine().processForUser(scope, profile());
    expect(result.success).toBe(false); expect(result.errors).toEqual([inboxRefreshMessage("failure")]);
    expect(storage.commitInboxRefresh).not.toHaveBeenCalled();
  });
  it("rejects a non-feed 200 response", async () => {
    storage.getUserSources.mockResolvedValue([source("bad")]); network.mockResolvedValue({ ...feed("https://news.test"), text: "<html>Not a feed</html>" });
    await expect(new Engine().fetchSources()).rejects.toThrow();
    expect(storage.updateUserSource).toHaveBeenCalledWith(scope, "bad", expect.objectContaining({ lastFetchStatus: "error" }));
  });
  it("records webpage quality failures and never creates login/navigation inbox articles", async () => {
    storage.getUserSources.mockResolvedValue([{ ...source("portal"), sourceType: "webpage" }]);
    network.mockResolvedValue({ ...feed("https://news.test/portal"), text: "<html><main>Log in to continue</main></html>", headers: new Headers({ "content-type": "text/html" }) });
    const result = await new Engine().processForUser(scope, profile());
    expect(result.success).toBe(false);
    expect(storage.createInboxItem).not.toHaveBeenCalled();
    expect(storage.updateUserSource).toHaveBeenCalledWith(scope, "portal", expect.objectContaining({ lastFetchStatus: "error", lastFetchError: expect.stringContaining("No readable article body") }));
  });
  it("bounds source workers to three and source count to thirty", async () => {
    vi.useFakeTimers();
    storage.getUserSources.mockResolvedValue(Array.from({ length: 60 }, (_, i) => source(String(i))));
    let active = 0; let maximum = 0;
    network.mockImplementation(async (url: string) => {
      active++; maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5)); active--; return feed(url);
    });
    const task = new Engine().fetchSources(); await vi.advanceTimersByTimeAsync(100); await task;
    expect(maximum).toBe(3); expect(network).toHaveBeenCalledTimes(30); expect(storage.updateUserSource).toHaveBeenCalledTimes(30);
  });
  it("stops starting sources after the refresh budget and leaves unattempted rows untouched", async () => {
    vi.useFakeTimers();
    storage.getUserSources.mockResolvedValue(Array.from({ length: 10 }, (_, i) => source(String(i))));
    network.mockImplementation(async (_url: string, options: { signal: AbortSignal }) => new Promise((_, reject) => {
      options.signal.addEventListener("abort", () => reject(new CrawlError("timeout", "Cancelled")));
    }));
    const task = expect(new Engine().fetchSources()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(20000); await task;
    expect(network).toHaveBeenCalledTimes(3); expect(storage.updateUserSource).toHaveBeenCalledTimes(3);
  });
});