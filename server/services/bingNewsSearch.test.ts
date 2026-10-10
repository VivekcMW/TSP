import Parser from "rss-parser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { crawl, network } = vi.hoisted(() => ({ crawl: vi.fn(), network: vi.fn(() => { throw new Error("Unexpected network request"); }) }));
vi.mock("./crawlerFetch", async original => ({ ...await original<typeof import("./crawlerFetch")>(), fetchPublicText: crawl }));
vi.mock("node-fetch", () => ({ default: network }));
import { bingPublisherUrl, fetchBingArticlesForQuery } from "./bingNewsSearch";
import { CrawlError } from "./crawlerFetch";

const click = (target: string) => `http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=abc&amp;url=${encodeURIComponent(target)}&amp;c=123&amp;mkt=en-in`;
const item = (title: string, target: string, source = "Deccan Herald", date = "Sun, 27 Sep 2026 19:21:30 GMT") =>
  `<item><title>${title}</title><link>${click(target)}</link><description>About ${title}.</description><pubDate>${date}</pubDate><News:Source>${source}</News:Source></item>`;
const rss = (items: string) => `<?xml version="1.0" encoding="utf-8" ?><rss version="2.0" xmlns:News="https://www.bing.com/news/search?q=x&amp;format=rss"><channel><title>x - BingNews</title>${items}</channel></rss>`;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", network);
  vi.spyOn(Parser.prototype, "parseURL").mockImplementation(() => { throw new Error("Direct parser networking is forbidden"); });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bingPublisherUrl", () => {
  it("reads the publisher link out of Bing's click-through address", () => {
    expect(bingPublisherUrl("http://www.bing.com/news/apiclick.aspx?ref=FexRss&url=https%3a%2f%2fwww.deccanherald.com%2fhealth%2fstory&c=1"))
      .toBe("https://www.deccanherald.com/health/story");
  });

  it("refuses anything that isn't a web link to a publisher", () => {
    for (const link of [
      "https://evil.test/news/apiclick.aspx?url=https%3a%2f%2fpublisher.test%2fa",
      "http://www.bing.com/news/apiclick.aspx?url=javascript%3aalert(1)",
      "http://www.bing.com/news/apiclick.aspx?url=https%3a%2f%2fwww.msn.com%2fen-in%2fnews%2fa",
      "http://www.bing.com/news/apiclick.aspx?url=https%3a%2f%2fwww.bing.com%2fnews",
      "http://www.bing.com/news/apiclick.aspx",
      "not a url",
    ]) expect(bingPublisherUrl(link)).toBeNull();
  });
});

describe("fetchBingArticlesForQuery", () => {
  it("asks for the edition's market and the past 30 days, and returns stories with direct links", async () => {
    crawl.mockResolvedValue({ text: rss(item("Drug price gaps", "https://www.deccanherald.com/health/drug-price-gaps")) });
    const result = await fetchBingArticlesForQuery("drug pricing India", 8, "en-IN");
    const url = new URL(crawl.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://www.bing.com/news/search");
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: "drug pricing India", format: "rss", setmkt: "en-IN", qft: 'interval="9"' });
    expect(crawl.mock.calls[0][1]).toMatchObject({ timeoutMs: 8000 });
    expect(result).toEqual([{
      title: "Drug price gaps", link: "https://www.deccanherald.com/health/drug-price-gaps", source: "Deccan Herald",
      sourceOrigin: "https://www.deccanherald.com", content: "About Drug price gaps.", categories: ["drug pricing India"],
      inputKind: "provider_excerpt", pubDate: "2026-09-27T19:21:30.000Z", publishedAt: "2026-09-27T19:21:30.000Z",
      publicationDate: expect.objectContaining({ publishedAt: "2026-09-27T19:21:30.000Z" }),
    }]);
  });

  it("leaves out MSN copies, which can't be read to write a post, and keeps at most maxItems", async () => {
    crawl.mockResolvedValue({ text: rss([
      item("Syndicated", "https://www.msn.com/en-in/news/india/a", "Hindustan Times on MSN"),
      ...Array.from({ length: 10 }, (_, i) => item(`Story ${i}`, `https://publisher.test/${i}`)),
    ].join("")) });
    const result = await fetchBingArticlesForQuery("AI", 3);
    expect(result.map(article => article.link)).toEqual(["https://publisher.test/0", "https://publisher.test/1", "https://publisher.test/2"]);
  });

  it("keeps only headlines written in the edition's script", async () => {
    // Bing's market filter let 3 Chinese headlines into 12 results for an English search.
    const mixed = rss([
      item("Salesforce CEO: AI will not kill SaaS", "https://publisher.test/en"),
      item("Salesforce CEO：投资Anthropic或带来数百亿美元回报", "https://publisher.test/zh"),
      item("L'IA générative change la santé", "https://publisher.test/fr"),
      item("人工知能が医療を変える", "https://publisher.test/ja"),
      item("स्वास्थ्य तकनीक में नई पहल", "https://publisher.test/hi"),
    ].join(""));
    const titles = async (edition: string) => { crawl.mockResolvedValue({ text: mixed }); return (await fetchBingArticlesForQuery("AI", 8, edition)).map(article => article.link.split("/").pop()); };
    expect(await titles("en-US")).toEqual(["en", "fr"]);
    expect(await titles("fr-FR")).toEqual(["en", "fr"]);
    expect(await titles("ja-JP")).toEqual(["ja"]);
    expect(await titles("hi-IN")).toEqual(["hi"]);
  });

  it("falls back to the default market for an unknown edition", async () => {
    crawl.mockResolvedValue({ text: rss("") });
    expect(await fetchBingArticlesForQuery("AI", 8, "xx-XX")).toEqual([]);
    expect(new URL(crawl.mock.calls[0][0]).searchParams.get("setmkt")).toBe("en-US");
  });

  it("doesn't search for empty or oversized queries, or once cancelled", async () => {
    expect(await fetchBingArticlesForQuery("   ")).toEqual([]);
    expect(await fetchBingArticlesForQuery("x".repeat(500))).toEqual([]);
    const controller = new AbortController(); controller.abort();
    await expect(fetchBingArticlesForQuery("AI", 8, "en-US", controller.signal)).rejects.toBeInstanceOf(CrawlError);
    expect(crawl).not.toHaveBeenCalled();
  });

  it("throws a safe error and logs only fixed text when Bing fails", async () => {
    crawl.mockRejectedValue(new Error("Private query secret & full URL"));
    await expect(fetchBingArticlesForQuery("Private query secret")).rejects.toEqual(
      new CrawlError("search", "Article search failed or was cancelled. Please try again."));
    expect(console.error).toHaveBeenCalledExactlyOnceWith("[bingNewsSearch] Search request failed or was cancelled.");
  });
});
