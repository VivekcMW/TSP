import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchPublicText } = vi.hoisted(() => ({ fetchPublicText: vi.fn() }));
vi.mock("./crawlerFetch.js", async original => ({ ...await original<typeof import("./crawlerFetch")>(), fetchPublicText }));
import { extractArticleFromHtml, fetchArticleFromUrl } from "./urlFetcher";
import { buildEvidenceBrief, verifySourceExcerpt } from "./editorialEvidence";

beforeEach(() => fetchPublicText.mockReset());

describe("article extraction evidence", () => {
  it("retains more than 3000 characters and limits at 24000 with metadata", () => {
    const text = "Reported source passage with details and limitations. ".repeat(600).trim();
    const article = extractArticleFromHtml(`<title>Trial</title><article><p>${text}</p></article>`, "https://news.test/story");
    expect(article.content.length).toBe(24_000);
    expect(article.contentMetadata).toEqual({ extractionMethod: "article", originalLength: text.length, retainedLength: 24_000, truncated: true });
    const brief = buildEvidenceBrief(article);
    expect(brief.warnings.map(warning => warning.code)).toContain("source_truncated");
    expect(brief.excerpts.every(excerpt => verifySourceExcerpt(article.content, excerpt))).toBe(true);
  });

  const body = "<article><p>The publisher reported a pilot with measurable results across thirty stores and noted its limitations.</p></article>";
  it.each([
    ['<meta property="og:site_name" content="Campaign India">', "Campaign India"],
    ['<meta property="og:site_name" content="Ad &amp; Marketing Times">', "Ad & Marketing Times"],
    ['<meta name="application-name" content="Brand Equity">', "Brand Equity"],
  ])("uses the publisher's declared name from %s", (meta, expected) => {
    expect(extractArticleFromHtml(`<title>Pilot</title>${meta}${body}`, "https://www.campaignindia.in/article/x").source).toBe(expected);
  });

  it.each([
    ["no declared name", ""],
    ["a URL", '<meta property="og:site_name" content="https://www.campaignindia.in/">'],
    ["an overlong value", `<meta property="og:site_name" content="${"Campaign India ".repeat(6)}">`],
  ])("falls back to the domain name for %s", (_label, meta) => {
    expect(extractArticleFromHtml(`<title>Pilot</title>${meta}${body}`, "https://www.campaignindia.in/article/x").source).toBe("Campaignindia");
  });

  it("preserves paragraphs and decodes entities before calculating offsets", () => {
    const article = extractArticleFromHtml('<main><p>First &amp; second groups reported improvements during the trial.</p><p>Third &quot;quoted&quot; paragraph describes limitations of the reported findings.</p></main>', "https://news.test/story");
    expect(article.content).toBe('First & second groups reported improvements during the trial.\n\nThird "quoted" paragraph describes limitations of the reported findings.');
    expect(article.contentMetadata?.extractionMethod).toBe("main");
    expect(buildEvidenceBrief(article).excerpts).toHaveLength(2);
  });

  it("rejects description-only teasers instead of treating metadata as an article", () => {
    expect(() => extractArticleFromHtml('<title>Trial</title><meta name="description" content="Only a teaser is available.">', "https://news.test/story"))
      .toThrow(expect.objectContaining({ code: "quality" }));
  });

  it("keeps densest-cluster extraction and its paragraph boundaries", () => {
    const first = "This is a source paragraph with enough text to pass the existing fifty-character threshold.";
    const second = "Another adjacent source paragraph provides details and important limitations about the trial.";
    const article = extractArticleFromHtml(`<p>${first}</p><p>${second}</p>`, "https://news.test/story");
    expect(article.content).toBe(`${first}\n\n${second}`);
    expect(article.contentMetadata?.extractionMethod).toBe("paragraph_cluster");
  });

  it("continues to reject empty and JavaScript-only bodies", () => {
    expect(() => extractArticleFromHtml("<article>Loading...</article>", "https://news.test/story")).toThrow();
    expect(() => extractArticleFromHtml("<title>No body</title>", "https://news.test/story")).toThrow();
  });

  it("uses the guarded fetch and final URL, forwarding cancellation", async () => {
    const controller = new AbortController();
    fetchPublicText.mockResolvedValue({ text: "<article>A reported trial describes its methods and concrete findings, including the limitations of this study.</article>", url: "https://news.test/final", headers: new Headers({ "content-type": "text/html" }) });
    const article = await fetchArticleFromUrl("https://news.test/start", controller.signal);
    expect(fetchPublicText).toHaveBeenCalledExactlyOnceWith("https://news.test/start", { signal: controller.signal });
    expect(article.url).toBe("https://news.test/final");
  });
});