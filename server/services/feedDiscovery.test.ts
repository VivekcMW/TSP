import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { Headers } from "node-fetch";
const { network } = vi.hoisted(() => ({ network: vi.fn() }));
vi.mock("./crawlerFetch", async (original) => ({ ...await original<typeof import("./crawlerFetch")>(), fetchPublicText: network }));
import { CrawlError } from "./crawlerFetch";
import { discoverFeed } from "./feedDiscovery";

const feed = JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: [{ title: "Story", url: "https://news.test/story", content_text: "Real story text" }] });
const page = (url: string, text: string, type = "text/html") => ({ url, text, status: 200, headers: new Headers({ "content-type": type }) });
beforeEach(() => { vi.resetAllMocks(); network.mockRejectedValue(new CrawlError("http", "The source returned HTTP 404.")); });
afterEach(() => vi.useRealTimers());

describe("bounded explicit-URL feed discovery", () => {
  it.each(["Campaign", "Nielsen Insights", "Marketing Week", "", "mailto:editor@news.test"])("never guesses a domain for %s", async (name) => {
    expect(await discoverFeed(name)).toHaveProperty("error"); expect(network).not.toHaveBeenCalled();
  });
  it("normalizes bare domains, parses real feeds and records the final URL", async () => {
    network.mockResolvedValue(page("https://www.news.test/feed", feed, "application/feed+json"));
    expect(await discoverFeed("news.test/feed")).toMatchObject({ sourceType: "feed", feedUrl: "https://www.news.test/feed", name: "news.test" });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it("resolves declared feeds relative to the canonical homepage and stops early", async () => {
    network.mockImplementation(async (url: string) => {
      if (url === "https://news.test/") return page("https://www.news.test/", '<html><link rel="alternate" type="application/rss+xml" href="/actual.xml"></html>');
      if (url === "https://www.news.test/actual.xml") return page(url, feed);
      throw new CrawlError("http", "Not found");
    });
    expect(await discoverFeed("news.test")).toMatchObject({ feedUrl: "https://www.news.test/actual.xml" });
    expect(network.mock.calls.filter(([url]) => url === "https://news.test/")).toHaveLength(1);
    expect(network.mock.calls.length).toBeLessThanOrEqual(3);
  });
  it.each(["blocked", "http", "timeout", "size"])("returns an honest %s error rather than a webpage success", async (code) => {
    network.mockRejectedValue(new CrawlError(code, "The source cannot be read."));
    expect(await discoverFeed("https://news.test/")).toEqual({ error: "The source cannot be read." });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it("caps probes, deduplicates failed requests and accepts a readable webpage fallback", async () => {
    const body = '<html><title>A webpage</title><main><p>This is meaningful readable public article content, rather than a JavaScript-only empty shell.</p></main></html>';
    network.mockImplementation(async (url: string) => {
      if (url === "https://news.test/") return page(url, body);
      throw new CrawlError("http", "Not found");
    });
    expect(await discoverFeed("https://news.test/")).toMatchObject({ sourceType: "webpage" });
    expect(network.mock.calls.length).toBeLessThanOrEqual(16);
    const urls = network.mock.calls.map(([url]) => url);
    expect(new Set(urls).size).toBe(urls.length);
  });
  it("does not substitute a site's feed for an explicitly supplied article", async () => {
    network.mockResolvedValue(page("https://news.test/story", '<html><meta content="article" property="og:type"><title>Story</title><article><p>A reported trial describes its methods and concrete findings, including the limitations of this study.</p></article><link rel="alternate" type="application/rss+xml" href="/feed"></html>'));
    expect(await discoverFeed("https://news.test/story")).toMatchObject({ sourceType: "webpage", feedUrl: "https://news.test/story" });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['<html><title>Just a moment</title><main>Verify</main></html>', "text/html"],
    ['<html><title>Empty shell</title><div id="root"></div></html>', "text/html"],
    ["%PDF binary", "application/pdf"],
  ])("rejects challenge/shell/non-HTML content", async (body, type) => {
    network.mockResolvedValue(page("https://news.test/", body, type));
    expect(await discoverFeed("https://news.test/")).toHaveProperty("error");
  });
  it("routes Apple's lookup and returned feed through the same guarded helper", async () => {
    network.mockImplementation(async (url: string) => url.startsWith("https://itunes.apple.com/")
      ? page(url, JSON.stringify({ results: [{ feedUrl: "https://podcast.test/feed", collectionName: "Podcast" }] }), "application/json")
      : page(url, feed, "application/feed+json"));
    expect(await discoverFeed("https://podcasts.apple.com/us/podcast/title/id12345")).toMatchObject({ sourceType: "feed", name: "Podcast" });
    expect(network.mock.calls.map(([url]) => url)).toEqual(["https://itunes.apple.com/lookup?id=12345", "https://podcast.test/feed"]);
  });
  it("rejects navigation-only listings even when their links look like articles", async () => {
    const links = ["account", "preferences", "dashboard"].map(slug => `<a href="/${slug}">Open your personal ${slug}</a>`).join("");
    network.mockImplementation(async (url: string) => {
      if (url === "https://news.test/") return page(url, `<html><main>${links}</main></html>`);
      if (/account|preferences|dashboard/.test(url)) return page(url, '<html><main>Log in to continue</main></html>');
      throw new CrawlError("http", "Not found");
    });
    expect(await discoverFeed("https://news.test/")).toEqual({ error: expect.stringMatching(/No readable public articles/) });
    expect(network.mock.calls.length).toBeLessThanOrEqual(16);
  });
  it("accepts a listing only after validating an actual public child article", async () => {
    const links = ["one", "two", "three"].map(slug => `<a href="/${slug}">Read the detailed story ${slug}</a>`).join("");
    network.mockImplementation(async (url: string) => {
      if (url === "https://news.test/") return page(url, `<html><main>${links}</main></html>`);
      if (url.endsWith("/one")) return page(url, '<html><article><p>A reported trial describes its methods and concrete findings, including the limitations of this study.</p></article></html>');
      throw new CrawlError("http", "Not found");
    });
    expect(await discoverFeed("https://news.test/")).toMatchObject({ sourceType: "webpage" });
    expect(network.mock.calls.some(([url]) => url === "https://news.test/one")).toBe(true);
  });
  it("cancels in-flight probes on the total deadline and starts no more", async () => {
    vi.useFakeTimers();
    network.mockImplementation(async (url: string, options: { signal: AbortSignal }) => {
      if (url === "https://news.test/") return page(url, '<html><title>Index</title><main>Index</main></html>');
      return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
    });
    const task = discoverFeed("news.test");
    await vi.advanceTimersByTimeAsync(12000);
    expect(await task).toHaveProperty("error");
    const calls = network.mock.calls.length;
    await vi.advanceTimersByTimeAsync(12000);
    expect(network).toHaveBeenCalledTimes(calls);
  });
});