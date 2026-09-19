import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicationDate, extractPublicationDate } from "./articleDates";
import { parseFeedContent } from "./universalFeedParser";
import { summarizeArticle } from "./articleSummary";
import { freshnessMultiplier, type ArticleQuality } from "@shared/article-quality";
import { diversityFeatures, selectDiverse, sourceOrigin } from "./inboxDiversity";
import { personalTrends, TREND_WINDOW_MS, type TrendRow } from "./personalTrends";
import { getCachedArticles } from "./engines/articleCache";

const now = Date.parse("2026-09-20T12:00:00Z");
afterEach(() => vi.restoreAllMocks());
const date = (raw: unknown) => publicationDate(raw, "rss-pubDate", now);
const body = "According to the research team, the pilot may reduce costs by 12%, but causation has not been established. A larger controlled trial is still required.";
const quality = (title = "AI software report", origin: string | null = "https://publisher.test", topics = ["AI"]): ArticleQuality => ({
  version: "quality-v1", date: date(null), freshness: { policy: "balanced-v1", multiplier: 0.6, evaluatedAt: new Date(now).toISOString() },
  relevance: { version: "concept-v1", evidence: topics.map(label => ({ label, weight: 0.7, type: "keyword", matchKind: "exact", matchedSurface: label, field: "title", span: { start: 0, end: label.length } })) },
  diversity: diversityFeatures(title, origin, topics), summary: summarizeArticle(body).provenance,
});

describe("publication provenance and precision", () => {
  it.each([undefined, null, ""])("keeps missing dates null: %s", raw => expect(date(raw)).toMatchObject({ publishedAt: null, quality: "missing" }));
  it.each(["2026-02-30T12:00:00Z", "30 Feb 2026 12:00:00 GMT", "2026-01-01T24:00:00Z"])("rejects invalid calendars/clocks %s", raw => expect(date(raw).publishedAt).toBeNull());
  it.each(["09/01/2026", "2026-01-01T12:00:00"])("rejects ambiguous precision/timezone %s", raw => expect(date(raw).quality).toBe("ambiguous"));
  it("validates instants, date-only and future without fabricating midnight", () => {
    expect(date("Fri, 18 Sep 2026 12:00:00 GMT")).toMatchObject({ publishedAt: "2026-09-18T12:00:00.000Z", precision: "instant" });
    expect(date("2026-09-18")).toMatchObject({ publishedAt: null, day: "2026-09-18", precision: "day", quality: "valid" });
    expect(date("2026-09-21T00:00:00Z")).toMatchObject({ publishedAt: null, quality: "future" });
  });
  it.each(["", "<published>not a date</published>", "<published>2026-09-18</published>"])("Atom never substitutes updated (%s)", async published => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const items = await parseFeedContent(`<feed xmlns="http://www.w3.org/2005/Atom"><title>News</title><entry><title>Story</title><link href="https://news.test/story"/>${published}<updated>2026-09-19T12:00:00Z</updated></entry></feed>`);
    expect(items).toHaveLength(1);
    expect(items![0].publishedAt).toBeNull();
  });
  it("retains explicit Atom publication instead of its updated timestamp", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const [item] = (await parseFeedContent('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Story</title><published>2020-01-01T00:00:00Z</published><updated>2026-09-19T12:00:00Z</updated></entry></feed>'))!;
    expect(item.publicationDate).toMatchObject({ publishedAt: "2020-01-01T00:00:00.000Z", publicationDateSource: "atom-published" });
  });
  it("does not treat JSON modified or RSS dc:date as publication", async () => {
    const json = await parseFeedContent(JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: [{ date_modified: "2020-01-01T00:00:00Z" }] }));
    expect(json![0].publishedAt).toBeNull();
    const rss = await parseFeedContent('<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><item><title>Story</title><dc:date>2020-01-01T00:00:00Z</dc:date></item></channel></rss>');
    expect(rss![0].publishedAt).toBeNull();
  });
  it("matches current JSON-LD identity, ignores related and modified dates, rejects conflicts", () => {
    const url = "https://news.test/story";
    const script = `<script type="application/ld+json">${JSON.stringify({ "@graph": [
      { "@type": "Article", url: "https://news.test/related", datePublished: "2026-09-19T00:00:00Z" },
      { "@type": "NewsArticle", mainEntityOfPage: { "@id": url }, datePublished: "2020-01-01T00::00Z", dateModified: "2026-09-19T00:00:00Z" },
    ] })}</script>`.replace("00::00Z", "00:00:00Z");
    expect(extractPublicationDate(script, url, now)).toMatchObject({ publishedAt: "2020-01-01T00:00:00.000Z", publicationDateSource: "jsonld-datePublished" });
    expect(extractPublicationDate(`<meta property="article:published_time" content="2021-01-01T00:00:00Z">${script}`, url, now).quality).toBe("conflicting");
    expect(extractPublicationDate(script, "https://news.test/other", now).publishedAt).toBeNull();
  });
  it.each([[0, 1], [7.99, 1], [8, 0.85], [30.99, 0.85], [31, 0.6]])("balanced-v1 day %s => %s", (days, multiplier) => {
    expect(freshnessMultiplier(new Date(now - days * 86400000).toISOString(), now)).toBe(multiplier);
  });
  it("does not let a date-only candidate mask disagreement between two instants", () => {
    const html = `<meta property="datePublished" content="2020-01-01"><script type="application/ld+json">${JSON.stringify(["01", "02"].map(hour => ({ "@type": "Article", url: "https://news.test/story", datePublished: `2020-01-01T${hour}:00:00Z` })))}</script>`;
    expect(extractPublicationDate(html, "https://news.test/story", now).quality).toBe("conflicting");
  });
  it.each([null, "bad", "2027-01-01"])("unknown/future is not fresh %s", raw => expect(freshnessMultiplier(raw, now)).toBe(0.6));
});

describe("contiguous extractive passages", () => {
  it("preserves attribution, qualifiers and figures with verifiable input hash and span", () => {
    const input = `  ${body}  Incomplete ending`;
    const result = summarizeArticle(input, "page_body");
    expect(result.summary).toBe(body);
    const span = result.provenance.spans[0];
    expect(input.slice(span.start, span.end)).toBe(result.summary);
    expect(result.provenance).toMatchObject({ version: "contiguous-v1", method: "extractive", inputHash: createHash("sha256").update(input).digest("hex") });
  });
  it.each(["feed_excerpt", "provider_excerpt"] as const)("labels %s as source excerpt", kind => expect(summarizeArticle(body, kind).provenance.method).toBe("source_excerpt"));
  it.each(["Short.", "Incomplete words without a terminal punctuation mark", "A long enough lead that trails away before stating the full qualification...", "x".repeat(701) + "."])("does not invent or cut text %s", input => {
    expect(summarizeArticle(input)).toMatchObject({ summary: null, provenance: { method: "unavailable", spans: [] } });
  });
  it("bounds input and output without stitching later sentences", () => {
    const result = summarizeArticle(body.repeat(1000));
    expect(result.summary!.length).toBeLessThanOrEqual(700);
    expect(result.provenance.warnings).toContain("input_bounded");
    expect(result.provenance.spans).toHaveLength(1);
  });
  it("does not accept an incomplete quoted ellipsis as a complete passage", () => {
    expect(summarizeArticle('The researcher said, “These early findings may indicate a possible benefit, but we must wait...”').summary).toBeNull();
  });
});

describe("diverse deterministic membership", () => {
  const candidate = (id: string, title: string, origin = "https://one.test", rank = 0.5) => ({ articleUrl: `https://news.test/${id}`, relevanceScore: String(rank), rankingScore: String(rank), qualityMetadata: quality(title, origin) });
  it("uses URL origins, not names or Google wrappers", () => {
    expect(sourceOrigin("Publisher name")).toBeNull();
    expect(sourceOrigin("https://news.google.com/rss/articles/123")).toBeNull();
    expect(sourceOrigin("https://publisher.test/story")).toBe("https://publisher.test");
  });
  it("is order independent, softly diversifies and never fills with irrelevant items", () => {
    const pool = [candidate("a", "First development"), candidate("b", "Second development"), candidate("c", "Third development", "https://two.test", 0.49), candidate("d", "Irrelevant", "https://three.test", 0)];
    expect(selectDiverse(pool, 2).map(c => c.articleUrl)).toEqual([pool[0].articleUrl, pool[2].articleUrl]);
    expect(selectDiverse([...pool].reverse(), 2)).toEqual(selectDiverse(pool, 2));
    expect(selectDiverse(pool, 10)).toHaveLength(3);
  });
  it("groups copies while keeping different figures, developments and Unicode", () => {
    const pool = [candidate("a", "研究 costs fall 12%"), candidate("b", "研究 costs fall 12%"), candidate("c", "研究 costs fall 15%"), candidate("d", "研究 costs do not fall 12%")];
    expect(selectDiverse(pool, 10)).toHaveLength(3);
    expect(pool[0].qualityMetadata.diversity.titleTokens).toContain("研究");
  });
  it("relaxes with one source and retains old generic caller tie order", () => {
    const pool = Array.from({ length: 12 }, (_, i) => candidate(String(i), `Development ${i}`));
    expect(selectDiverse(pool, 10)).toHaveLength(10);
    const legacy = pool.map(({ qualityMetadata: _, ...c }) => c);
    expect(selectDiverse(legacy, 10)).toEqual(legacy.slice(0, 10));
  });
  it("keeps identical headlines when body figures or developments differ", () => {
    const pool = ["Costs fell by 12%.", "Costs fell by 15%.", "The earlier estimate has been withdrawn."].map((content, i) => ({
      ...candidate(String(i), "AI study update"), qualityMetadata: { ...quality(), diversity: diversityFeatures("AI study update", "https://one.test", ["AI"], content) },
    }));
    expect(selectDiverse(pool, 10)).toHaveLength(3);
  });
});

describe("personal admitted-content windows", () => {
  const row = (id: string, age = 1, origin: string | null = "https://publisher.test"): TrendRow => ({ articleUrl: `https://news.test/${id}`, headline: id, source: "Untrusted label", discoveredAt: new Date(now - age * TREND_WINDOW_MS), matchedKeywords: ["wrong"], relevanceScore: "0.5", qualityMetadata: quality(id, origin, [" AI ", "ai"]) });
  it("uses half-open windows, canonical dedup, normalized evidence topics and unknown origins", () => {
    const rows = [row("previous", 2), row("current", 1), row("other", 0.5, null), row("current?utm_source=copy", 0.2), row("now", 0), row("too-old", 2.01)];
    expect(personalTrends(rows, new Date(now))).toMatchObject([{ topic: "ai", count: 2, previousCount: 1, delta: 1, velocityPercent: 100, sourceCount: 1, unknownSourceCount: 1, timeBasis: "discoveredAt" }]);
  });
  it("requires two distinct articles and excludes manual/source-only rows", () => {
    expect(personalTrends([row("only", 0.5), { ...row("manual", 0.5), relevanceScore: "0" }, { ...row("source", 0.5), qualityMetadata: quality("source", null, []) }], new Date(now))).toEqual([]);
    expect(personalTrends([row("one", 0.5), row("two", 0.5)], new Date(now))[0]).toMatchObject({ velocityPercent: null, label: "new" });
  });
  it("includes beyond 200 and explicitly marks its bounded partial sample", () => {
    const rows = Array.from({ length: 5001 }, (_, i) => row(String(i), 0.5));
    expect(personalTrends(rows.slice(0, 620), new Date(now))[0]).toMatchObject({ count: 620, coverage: { partial: false, rowsExamined: 620 } });
    expect(personalTrends(rows, new Date(now))[0]).toMatchObject({ count: 5000, coverage: { partial: true, rowLimit: 5000 } });
  });
});

it("cache retains nullable dates/provenance and returns detached public metadata", async () => {
  const item = { title: "AI", content: body, source: "Publisher", link: "https://news.test/cache", categories: [], pubDate: null, publishedAt: null, publicationDate: date(null), inputKind: "provider_excerpt" as const, sourceOrigin: null };
  const fetch = vi.fn().mockResolvedValue([item]);
  const first = await getCachedArticles("quality-v1-fixture", fetch);
  expect(first).toEqual([item]);
  first[0].publicationDate!.quality = "invalid";
  expect(await getCachedArticles("quality-v1-fixture", fetch)).toEqual([item]);
  expect(fetch).toHaveBeenCalledTimes(1);
});