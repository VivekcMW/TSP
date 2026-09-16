import { Headers } from "node-fetch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { network } = vi.hoisted(() => ({ network: vi.fn() }));
vi.mock("./crawlerFetch", async (original) => ({ ...await original<typeof import("./crawlerFetch")>(), fetchPublicText: network }));
import { CrawlError } from "./crawlerFetch";
import { scrapeWebpageArticles, extractListingLinks } from "./webpageScraper";
import { fetchArticleFromUrl } from "./urlFetcher";

const page = (url: string, text: string) => ({ url, text, status: 200, headers: new Headers({ "content-type": "text/html" }) });
const paragraph = "A detailed account of the development with concrete findings and useful context from the original author.";
const article = (title: string) => `<html><title>${title}</title><article><h1>${title}</h1><p>${paragraph}</p><p>${paragraph}</p></article></html>`;
const links = (count: number) => Array.from({ length: count }, (_, i) => `<a href="/article-${i}">A real linked article number ${i}</a>`).join("");
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => vi.useRealTimers());

describe("webpage article crawling", () => {
  it("fetches listing bodies with two workers and a ten-link limit", async () => {
    vi.useFakeTimers();
    let active = 0; let maximum = 0;
    network.mockImplementation(async (url: string) => {
      if (url === "https://news.test/") return page(url, `<html><main>${links(30)}</main></html>`);
      active++; maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--; return page(url, article("Fetched title"));
    });
    const task = scrapeWebpageArticles("https://news.test/");
    await vi.advanceTimersByTimeAsync(100);
    const result = await task;
    expect(result).toHaveLength(10); expect(maximum).toBe(2); expect(network).toHaveBeenCalledTimes(11);
    expect(result.every((item) => item.title === "Fetched title" && item.content.includes(paragraph))).toBe(true);
  });
  it("keeps an actual article despite navigation and related-article links", async () => {
    network.mockResolvedValue(page("https://news.test/story", article("One story").replace("</article>", `${links(6)}</article>`)));
    const result = await scrapeWebpageArticles("https://news.test/story");
    expect(result).toHaveLength(1); expect(result[0].link).toBe("https://news.test/story");
    expect(result[0].content).toContain(paragraph); expect(network).toHaveBeenCalledTimes(1);
  });
  it.each([
    `<article><p>${paragraph}</p>${links(4)}</article>`,
    `<main><h1>One detailed story</h1><p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p>${links(3)}</main>`,
  ])("recognizes a single paragraph article or prose-heavy main despite related links", async (body) => {
    network.mockResolvedValue(page("https://news.test/story", `<html><title>Story</title>${body}</html>`));
    const result = await scrapeWebpageArticles("https://news.test/story");
    expect(result).toHaveLength(1); expect(result[0].link).toBe("https://news.test/story");
    expect(network).toHaveBeenCalledTimes(1);
  });
  it("does not mistake structured Article entries inside a listing for one story", async () => {
    const cards = Array.from({ length: 3 }, (_, i) => `<article><p>Preview text</p><a href="/article-${i}">Read the full story number ${i}</a></article>`).join("");
    network.mockImplementation(async (url: string) => url === "https://news.test/"
      ? page(url, `<html><script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"@type":"Article"}]}</script><main>${cards}</main></html>`)
      : page(url, article("Actual story")));
    expect(await scrapeWebpageArticles("https://news.test/")).toHaveLength(3);
    expect(network).toHaveBeenCalledTimes(4);
  });
  it("excludes navigation, fragments, credentials, other origins and duplicate links", () => {
    const html = `<nav>${links(4)}</nav><footer>${links(4)}</footer>
      <a href="/story#one">One real article title</a><a href="/story#two">Same article different hash</a>
      <a href="#top">A same page anchor</a><a href="/">A same page root link</a>
      <a href="https://elsewhere.test/story">Cross origin article</a><a href="http://news.test/story">Downgrade origin article</a>
      <a href="https://news.test:8443/story">Other port article</a><a href="https://u:p@news.test/secret">Credentialed URL link</a>
      <a href="/privacy">Our privacy information</a>`;
    expect(extractListingLinks(html, "https://news.test/")).toEqual([{ title: "One real article title", link: "https://news.test/story" }]);
  });
  it("skips failed children and deduplicates successful redirects by final URL", async () => {
    network.mockImplementation(async (url: string) => {
      if (url === "https://news.test/") return page(url, `<html><main>${links(3)}</main></html>`);
      if (url.endsWith("0")) throw new CrawlError("http", "The source returned HTTP 403.");
      return page("https://news.test/canonical", article("Real content"));
    });
    const result = await scrapeWebpageArticles("https://news.test/");
    expect(result).toHaveLength(1); expect(result[0].link).toBe("https://news.test/canonical");
    expect(result[0].content).toContain(paragraph);
  });
  it("reports failure if no listing children are readable", async () => {
    network.mockImplementation(async (url: string) => {
      if (url === "https://news.test/") return page(url, `<html><main>${links(3)}</main></html>`);
      throw new CrawlError("http", "The source returned HTTP 403.");
    });
    await expect(scrapeWebpageArticles("https://news.test/")).rejects.toMatchObject({ code: "content" });
  });
  it("does not return placeholder articles when the network or extraction fails", async () => {
    network.mockRejectedValue(new CrawlError("http", "The source returned HTTP 403."));
    await expect(fetchArticleFromUrl("https://news.test/story")).rejects.toMatchObject({ code: "http" });
    network.mockResolvedValue(page("https://news.test/story", '<html><title>Shell</title><div id="root"></div></html>'));
    await expect(fetchArticleFromUrl("https://news.test/story")).rejects.toMatchObject({ code: "quality" });
  });
  it("returns final URL/domain and strips script, navigation and footer content", async () => {
    network.mockResolvedValue(page("https://canonical.test/story", article("A &amp; B").replace("</article>", '<script>SECRET_SCRIPT</script><nav>NAV_JUNK</nav><footer>FOOTER_JUNK</footer></article>')));
    const result = await fetchArticleFromUrl("https://news.test/story");
    expect(result.url).toBe("https://canonical.test/story"); expect(result.domain).toBe("canonical.test");
    expect(result.title).toBe("A & B"); expect(result.content).not.toMatch(/SECRET_SCRIPT|NAV_JUNK|FOOTER_JUNK/);
  });
  it.each([
    '<html><title>Portal</title><main>Log in to continue</main></html>',
    `<html><title>Portal</title><main>${"Home Account Preferences Dashboard Notifications Search Settings Support ".repeat(4)}</main></html>`,
    `<html><title>Portal</title><main><h1>Account</h1><form><p>${paragraph}</p><input type="password"><button>Log in</button></form></main></html>`,
    `<html><meta property="og:type" content="article"><article><h1>Navigation</h1>${links(2)}</article></html>`,
    `<html><main><div role="navigation"><p>${paragraph}</p>${links(2)}</div></main></html>`,
    `<html><meta name="description" content="${paragraph}"><main><h1>Welcome</h1></main></html>`,
  ])("rejects login/navigation/teaser bodies instead of returning an article", async html => {
    network.mockResolvedValue(page("https://news.test/portal", html));
    await expect(fetchArticleFromUrl("https://news.test/portal")).rejects.toMatchObject({ code: expect.stringMatching(/quality|challenge/) });
    await expect(scrapeWebpageArticles("https://news.test/portal")).rejects.toMatchObject({ code: expect.stringMatching(/quality|challenge/) });
  });
  it("cancels a listing crawl and starts no further children after the deadline", async () => {
    vi.useFakeTimers();
    network.mockImplementation(async (url: string, options: { signal: AbortSignal }) => {
      if (url === "https://news.test/") return page(url, `<html><main>${links(10)}</main></html>`);
      return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new CrawlError("timeout", "Cancelled"))));
    });
    const task = expect(scrapeWebpageArticles("https://news.test/")).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(15000); await task;
    expect(network).toHaveBeenCalledTimes(3);
  });
});