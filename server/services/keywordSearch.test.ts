import Parser from "rss-parser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { crawl, network, decode, offline, modernDecode } = vi.hoisted(() => ({
  crawl: vi.fn(), network: vi.fn(() => { throw new Error("Unexpected network request"); }),
  decode: vi.fn(),
  offline: vi.fn(),
  modernDecode: vi.fn(),
}));
vi.mock("./crawlerFetch", async original => ({ ...await original<typeof import("./crawlerFetch")>(), fetchPublicText: crawl }));
vi.mock("decode-google-news-url", () => ({ decodeGoogleNewsUrl: decode, tryOfflineDecode: offline }));
vi.mock("google-news-decoder", () => ({ default: class { decodeGoogleNewsUrl = modernDecode; } }));
vi.mock("node-fetch", () => ({ default: network }));
import { fetchArticlesForQuery } from "./keywordSearch";
import { CrawlError } from "./crawlerFetch";

const rss = (items: string) => `<rss version="2.0"><channel><title>News</title>${items}</channel></rss>`;
const item = (extra = "", index = 0) => `<item><title>Story ${index}</title><link>https://news.test/${index}</link>${extra}</item>`;

beforeEach(() => {
  vi.resetAllMocks();
  decode.mockRejectedValue(new Error("Unexpected decoder request"));
  offline.mockReturnValue(null);
  modernDecode.mockRejectedValue(new Error("Unexpected decoder request"));
  vi.stubGlobal("fetch", network);
  // Fail closed if direct parser networking is accidentally reintroduced. All
  // fixtures enter through the crawler boundary; parseString stays real.
  vi.spyOn(Parser.prototype, "parseURL").mockImplementation(() => { throw new Error("Direct parser networking is forbidden"); });
  vi.spyOn(console, "error").mockImplementation(() => {});
  crawl.mockResolvedValue({ text: rss(item()) });
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled();
  expect(Parser.prototype.parseURL).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bounded Google News search", () => {
  it("keeps the query/maxItems call compatible and uses the default edition", async () => {
    crawl.mockResolvedValue({ text: rss(item("", 0) + item("", 1)) });
    expect(await fetchArticlesForQuery(" AI ", 1)).toHaveLength(1);
    const [rawUrl, options] = crawl.mock.calls[0];
    const url = new URL(rawUrl);
    expect(url.origin + url.pathname).toBe("https://news.google.com/rss/search");
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: "AI", hl: "en-US", gl: "US", ceid: "US:en" });
    expect(options).toEqual({ signal: undefined, timeoutMs: 8000 });
  });

  it.each([
    ["en-US", "en-US", "US", "US:en"], ["en-GB", "en-GB", "GB", "GB:en"],
    ["en-IN", "en-IN", "IN", "IN:en"], ["hi-IN", "hi", "IN", "IN:hi"],
    ["fr-FR", "fr", "FR", "FR:fr"], ["de-DE", "de", "DE", "DE:de"],
    ["es-ES", "es", "ES", "ES:es"], ["pt-BR", "pt-419", "BR", "BR:pt-419"],
    ["ja-JP", "ja", "JP", "JP:ja"], ["en-AU", "en-AU", "AU", "AU:en"],
    ["en-CA", "en-CA", "CA", "CA:en"],
  ])("uses allowlisted %s provider parameters without translating the query", async (edition, hl, gl, ceid) => {
    const query = '人工知能 भारत &hl=evil#fragment | "climate"';
    await fetchArticlesForQuery(query, 8, edition);
    const url = new URL(crawl.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://news.google.com/rss/search");
    expect(url.hash).toBe("");
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: query, hl, gl, ceid });
    expect([...url.searchParams.keys()]).toHaveLength(4);
  });

  it.each(["en-us", "en-US&gl=evil", "__proto__", "", " fr-FR "])("falls back safely for unsupported edition %s", async edition => {
    await fetchArticlesForQuery("AI", 8, edition);
    expect(Object.fromEntries(new URL(crawl.mock.calls[0][0]).searchParams))
      .toEqual({ q: "AI", hl: "en-US", gl: "US", ceid: "US:en" });
  });

  it.each(["", " \n\t ", "x".repeat(101), null, undefined, {}, 42])("rejects invalid query %# before any network", async query => {
    expect(await fetchArticlesForQuery(query as string)).toEqual([]);
    expect(crawl).not.toHaveBeenCalled();
  });

  it("accepts the 100-character boundary without truncating it", async () => {
    await fetchArticlesForQuery("x".repeat(100));
    expect(new URL(crawl.mock.calls[0][0]).searchParams.get("q")).toBe("x".repeat(100));
  });

  it.each([[undefined, 8], [100, 8], [Infinity, 8], [NaN, 8], [2.9, 2], [0, 0], [-1, 0]])(
    "bounds maxItems=%s to %s", async (limit, count) => {
      crawl.mockResolvedValue({ text: rss(Array.from({ length: 12 }, (_, i) => item("", i)).join("")) });
      expect(await fetchArticlesForQuery("AI", limit)).toHaveLength(count);
      expect(crawl).toHaveBeenCalledTimes(count ? 1 : 0);
    },
  );

  it.each(['<source url="https://publisher.test">Publisher</source>', '<source>Publisher</source>'])(
    "preserves source extraction through real parseString (%s)", async source => {
      crawl.mockResolvedValue({ text: rss(item(`${source}<pubDate>Fri, 18 Sep 2026 12:00:00 GMT</pubDate>
        <description><![CDATA[<p>Real <b>article</b> content</p>]]></description>
        <userSourceProvenance>active-user-source</userSourceProvenance><category>user-source</category>`)) });
      expect(await fetchArticlesForQuery("AI")).toMatchObject([{
        title: "Story 0", link: "https://news.test/0", source: "Publisher", content: "Real article content",
        pubDate: "2026-09-18T12:00:00.000Z", publishedAt: "2026-09-18T12:00:00.000Z", categories: ["AI"],
        sourceOrigin: source.includes("url=") ? "https://publisher.test" : null,
      }]);
    },
  );

  it("retains existing missing-field defaults and filters missing links", async () => {
    crawl.mockResolvedValue({ text: rss('<item><link>https://news.test/defaults</link></item><item><title>No link</title></item>') });
    const result = await fetchArticlesForQuery("AI");
    expect(result).toMatchObject([{
      title: "Untitled", link: "https://news.test/defaults", source: "Google News", content: "", categories: ["AI"],
      pubDate: null, publishedAt: null, publicationDate: { quality: "missing" },
    }]);
    expect(result[0].publishedAt).toBeNull();
  });

  it("decodes modern Google News article links before storing them", async () => {
    const wrapper = "https://news.google.com/rss/articles/opaque-token?oc=5";
    crawl.mockResolvedValue({ text: rss(`<item><title>Story</title><link>${wrapper}</link></item>`) });
    decode.mockResolvedValue("https://publisher.test/articles/story");
    const result = await fetchArticlesForQuery("AI");
    expect(result[0].link).toBe("https://publisher.test/articles/story");
    expect(decode).toHaveBeenCalledWith(wrapper);
  });

  it("leaves out stories whose Google News link cannot be resolved", async () => {
    const unresolved = "https://news.google.com/rss/articles/unresolvable?oc=5";
    const resolvable = "https://news.google.com/rss/articles/resolvable?oc=5";
    crawl.mockResolvedValue({ text: rss(`<item><title>Hidden</title><link>${unresolved}</link></item><item><title>Kept</title><link>${resolvable}</link></item>${item("", 3)}`) });
    decode.mockImplementation(async (url: string) => url === resolvable ? "https://publisher.test/kept" : url);
    const result = await fetchArticlesForQuery("AI");
    expect(result.map(article => [article.title, article.link])).toEqual([["Kept", "https://publisher.test/kept"], ["Story 3", "https://news.test/3"]]);
  });

  it("returns an empty result for a successfully parsed empty feed", async () => {
    crawl.mockResolvedValue({ text: rss("") });
    expect(await fetchArticlesForQuery("AI")).toEqual([]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each(["network", "parse"])("throws a safe error and logs only fixed text on %s failure", async failure => {
    if (failure === "network") crawl.mockRejectedValue(new Error("Private query secret & full URL"));
    else crawl.mockResolvedValue({ text: "<broken>Private query secret & full URL" });
    await expect(fetchArticlesForQuery("Private query secret")).rejects.toEqual(
      new CrawlError("search", "Article search failed or was cancelled. Please try again."));
    expect(console.error).toHaveBeenCalledExactlyOnceWith("[keywordSearch] Search request failed or was cancelled.");
  });

  it("does not start a cancelled query", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(fetchArticlesForQuery("AI", 8, "en-US", controller.signal)).rejects.toBeInstanceOf(CrawlError);
    expect(crawl).not.toHaveBeenCalled();
  });

  it("propagates cancellation to the crawler and awaits its settlement", async () => {
    const controller = new AbortController();
    let settled = false;
    crawl.mockImplementation(async (_url, { signal }) => {
      try {
        await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      } finally { settled = true; }
    });
    const pending = fetchArticlesForQuery("AI", 8, "fr-FR", controller.signal);
    expect(crawl).toHaveBeenCalledWith(expect.any(String), { signal: controller.signal, timeoutMs: 8000 });
    controller.abort();
    await expect(pending).rejects.toEqual(new CrawlError("search", "Article search failed or was cancelled. Please try again."));
    expect(settled).toBe(true);
  });
});