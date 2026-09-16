import { Headers } from "node-fetch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "@shared/schema";
const { storage, network, discovery } = vi.hoisted(() => ({
  storage: { getUserSources: vi.fn(), updateUserSource: vi.fn(), createUserSource: vi.fn(), getInboxItemByUrl: vi.fn(), createInboxItem: vi.fn() },
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
const profile = (publications: string[] = []) => ({ publications, keywords: [], companies: [], influencers: [] }) as unknown as UserProfile;
const source = (id: string) => ({ id, name: `Source ${id}`, feedUrl: `https://news.test/${id}`, sourceType: "feed", isActive: true, lastFetchedAt: null });
const feed = (url: string) => ({ url, text: JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: [{ title: "Real article", url: "https://news.test/story", content_text: "Real content" }] }), status: 200, headers: new Headers() });
beforeEach(() => {
  vi.resetAllMocks();
  storage.getUserSources.mockResolvedValue([]); storage.updateUserSource.mockResolvedValue({}); storage.createUserSource.mockResolvedValue({});
  network.mockImplementation(async (url: string) => feed(url)); discovery.mockResolvedValue({ error: "Unresolved" });
});
afterEach(() => vi.useRealTimers());

describe("source refresh reliability", () => {
  it("never materializes guessed publication names", async () => {
    await new Engine().processForUser(scope, profile(["Campaign", "Nielsen Insights", "Marketing Week"]));
    expect(discovery).not.toHaveBeenCalled(); expect(storage.createUserSource).not.toHaveBeenCalled();
  });
  it("materializes only explicit URLs and caps each attempt at four publications", async () => {
    discovery.mockResolvedValue({ name: "Actual host", feedUrl: "https://news.test/feed", sourceType: "feed" });
    await new Engine().processForUser(scope, profile(["Campaign", ...Array.from({ length: 10 }, (_, i) => `https://news-${i}.test/`)]));
    expect(discovery).toHaveBeenCalledTimes(4); expect(storage.createUserSource).toHaveBeenCalledTimes(4);
    expect(storage.createUserSource).toHaveBeenCalledWith(scope, expect.objectContaining({ name: "https://news-0.test/", addedVia: "publication" }));
  });
  it("does not create sources after the materialization budget expires", async () => {
    vi.useFakeTimers();
    discovery.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 7000));
      return { name: "Late", feedUrl: "https://news.test/feed", sourceType: "feed" };
    });
    const task = new Engine().processForUser(scope, profile(["https://news.test/"]));
    await vi.advanceTimersByTimeAsync(7000); await task;
    expect(storage.createUserSource).not.toHaveBeenCalled();
  });
  it("records real failure status instead of swallowing failure as ok", async () => {
    storage.getUserSources.mockResolvedValue([source("blocked"), source("good")]);
    network.mockImplementation(async (url: string) => {
      if (url.endsWith("blocked")) throw new CrawlError("http", "The source returned HTTP 403.");
      return feed(url);
    });
    expect(await new Engine().fetchSources()).toHaveLength(1);
    expect(storage.updateUserSource).toHaveBeenCalledWith(scope, "blocked", expect.objectContaining({ lastFetchStatus: "error", lastFetchError: "The source returned HTTP 403." }));
    expect(storage.updateUserSource).toHaveBeenCalledWith(scope, "good", expect.objectContaining({ lastFetchStatus: "ok", lastFetchError: null }));
  });
  it("reports all-failed runs as failed rather than an empty success", async () => {
    storage.getUserSources.mockResolvedValue([source("bad")]); network.mockRejectedValue(new CrawlError("network", "Unavailable"));
    const result = await new Engine().processForUser(scope, profile());
    expect(result.success).toBe(false); expect(result.errors?.[0]).toContain("None of your sources");
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