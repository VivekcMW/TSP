import { afterEach, describe, expect, it, vi } from "vitest";
import { extractPublicationDate, publicationDate } from "./articleDates";
import { parseFeedContent } from "./universalFeedParser";
import { summarizeArticle } from "./articleSummary";
import { diversityFeatures, selectDiverse } from "./inboxDiversity";
import type { ArticleQuality, PersonalTrend } from "@shared/article-quality";
import type { IIndustryEngine } from "./engines/types";
import { expectTypeOf } from "vitest";

const now = Date.parse("2026-09-19T12:00:00.000Z");
const url = "https://news.test/story";
const instant = "2026-09-18T12:00:00.000Z";
const meta = (raw: string, key = "article:published_time") => `<meta property="${key}" content="${raw}">`;
const node = (datePublished = instant, extra = {}) => ({ "@type": "Article", url, datePublished, ...extra });
const script = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
afterEach(() => vi.restoreAllMocks());

describe("DOM publication evidence review regressions", () => {
  it.each([
    `<!-- ${meta(instant)} -->`,
    `<script>const decoy = '${meta(instant)}';</script>`,
    `<!-- ${script(node())} -->`,
    `<script>const decoy = '<script type="application/ld+json">${JSON.stringify(node())}';</script>`,
    `<textarea>${meta(instant)}</textarea>`,
    `<template>${meta(instant)}${script(node())}</template>`,
  ])("ignores inert/comment/script-string evidence %#", html => {
    expect(extractPublicationDate(html, url, now)).toEqual(publicationDate(null, "unknown", now));
  });
  it.each(["datePublished", "DATEPUBLISHED", "article:published_time", "ARTICLE:PUBLISHED_TIME"])("normalizes meta key %s and HTML attributes", key => {
    expect(extractPublicationDate(`<META CONTENT='2026-09-18T12:00:00&#90;' NAME=' ${key} '>`, url, now))
      .toEqual(publicationDate(instant, "article-meta", now));
  });
  it("collects both supported key attributes without accepting unsupported aliases", () => {
    expect(extractPublicationDate(`<meta name="unrelated" itemprop="datePublished" content="${instant}">`, url, now).quality).toBe("valid");
    expect(extractPublicationDate(`<meta name="unrelated" property="DATEPUBLISHED" content="${instant}">`, url, now).quality).toBe("valid");
    for (const key of ["dateModified", "article:modified_time", "pubdate", "date", "dc.date"]) {
      expect(extractPublicationDate(meta(instant, key), url, now).quality).toBe("missing");
    }
  });
  it("collects every valid meta candidate and rejects conflicts in either order", () => {
    const tags = [meta(instant), meta("2026-09-17T12:00:00Z")];
    for (const ordered of [tags, [...tags].reverse()]) {
      expect(extractPublicationDate(ordered.join(""), url, now)).toEqual({ publishedAt: null, publicationDateSource: "unknown", precision: "unknown", quality: "conflicting" });
    }
  });
  it.each(["not a date", "2026-02-30T12:00:00Z", "2026-09-19T12:00:00.001Z"])("does not let %s hide later valid evidence", raw => {
    const expected = publicationDate(instant, "article-meta", now);
    expect(extractPublicationDate(meta(raw) + meta(instant), url, now)).toEqual(expected);
    expect(extractPublicationDate(meta(instant) + meta(raw), url, now)).toEqual(expected);
  });
  it("is order invariant for equivalent mixed evidence and invalid-only evidence", () => {
    for (const tags of [
      [script(node()), meta(instant), meta("2026-09-18", "datePublished")],
      [meta("bad"), meta("2026-02-30T12:00:00Z"), meta("2099-01-01T00:00:00Z")],
    ]) expect(extractPublicationDate(tags.join(""), url, now)).toEqual(extractPublicationDate([...tags].reverse().join(""), url, now));
  });
  it("accepts real unquoted/case-normalized JSON-LD script types, not script lookalikes", () => {
    expect(extractPublicationDate(`<SCRIPT TYPE=APPLICATION/LD+JSON>${JSON.stringify(node())}</SCRIPT>`, url, now))
      .toEqual(publicationDate(instant, "jsonld-datePublished", now));
    expect(extractPublicationDate(`<script data-type="application/ld+json">${JSON.stringify(node())}</script>`, url, now).quality).toBe("missing");
  });
  it("requires current article identity and does not traverse related or unsupported nodes", () => {
    for (const value of [node(instant, { url: undefined }), node(instant, { url: "/story" }), node(instant, { url: `${url}/related` }),
      node(instant, { "@type": "ItemList" }), { related: node() }, { "@type": "ItemList", itemListElement: [node()] },
      node(undefined, { datePublished: undefined, dateModified: instant })]) {
      expect(extractPublicationDate(script(value), url, now).quality).toBe("missing");
    }
    for (const identity of [{ "@id": `${url}?utm_source=test` }, { mainEntityOfPage: url }, { mainEntityOfPage: { "@id": url } }]) {
      expect(extractPublicationDate(script(node(instant, { url: undefined, ...identity })), url, now).publishedAt).toBe(instant);
    }
  });
  it("keeps JSON-LD script, character, array, depth and global visit bounds", () => {
    const missing = (html: string) => expect(extractPublicationDate(html, url, now).quality).toBe("missing");
    expect(extractPublicationDate(script({}).repeat(7) + script(node()), url, now).publishedAt).toBe(instant);
    missing(script({}).repeat(8) + script(node()));
    const raw = JSON.stringify(node());
    const sized = (size: number) => `<script type="application/ld+json">${raw.padEnd(size)}</script>`;
    expect(extractPublicationDate(sized(64_000), url, now).publishedAt).toBe(instant);
    missing(sized(64_001));
    expect(extractPublicationDate(script([...Array(29).fill(null), node()]), url, now).publishedAt).toBe(instant);
    missing(script([...Array(30).fill(null), node()]));
    const nested = (depth: number): unknown => depth ? { "@graph": nested(depth - 1) } : node();
    expect(extractPublicationDate(script(nested(6)), url, now).publishedAt).toBe(instant);
    missing(script(nested(7)));
    const prefix = script(Array(30).fill(null)).repeat(3); // 93 visits including array roots.
    expect(extractPublicationDate(prefix + script([...Array(5).fill(null), node()]), url, now).publishedAt).toBe(instant);
    missing(prefix + script([...Array(6).fill(null), node()]));
    expect(extractPublicationDate(" ".repeat(2_000_000 - meta(instant).length) + meta(instant), url, now).publishedAt).toBe(instant);
    missing(" ".repeat(2_000_000) + meta(instant));
    expect(extractPublicationDate(sized(64_001) + script(node()), url, now).publishedAt).toBe(instant);
  });
});

describe("exact publication instants across actual feed formats", () => {
  const formats = [
    { name: "RSS", source: "rss-pubDate", feed: (raw: string) => `<rss version="2.0"><channel><item><title>Story</title><pubDate>${raw}</pubDate></item></channel></rss>` },
    { name: "Atom", source: "atom-published", feed: (raw: string) => `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Story</title><published>${raw}</published><updated>2026-09-19T00:00:00Z</updated></entry></feed>` },
    { name: "JSON", source: "json-date_published", feed: (raw: string) => JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: [{ title: "Story", date_published: raw, date_modified: "2026-09-19T00:00:00Z" }] }) },
  ];
  it.each(formats)("$name retains exact instant, rejects now+1ms and preserves day precision", async ({ source, feed }) => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    for (const [raw, publishedAt, precision, quality] of [
      [instant, instant, "instant", "valid"],
      ["2026-09-19T12:00:00.000Z", "2026-09-19T12:00:00.000Z", "instant", "valid"],
      ["2026-09-19T12:00:00.001Z", null, "unknown", "future"],
      ["2026-09-18", null, "day", "valid"],
    ] as const) {
      const items = await parseFeedContent(feed(raw));
      expect(items).toHaveLength(1);
      expect(items![0]).toMatchObject({ pubDate: publishedAt, publishedAt, publicationDate: { publishedAt, publicationDateSource: source, precision, quality } });
    }
  });
  it.each(["2026-09-19T12:00:00.001Z", "2026-09-19T17:30:00.001+05:30", "2026-09-19T07:00:00.001-05:00"])("rejects exact now+1ms metadata %s", raw => {
    for (const html of [meta(raw), script(node(raw))]) expect(extractPublicationDate(html, url, now)).toMatchObject({ publishedAt: null, quality: "future" });
  });
  it("accepts RFC offsets exactly and rejects the first representable future second", () => {
    expect(publicationDate("Sat, 19 Sep 2026 17:30:00 +0530", "rss-pubDate", now).publishedAt).toBe("2026-09-19T12:00:00.000Z");
    expect(publicationDate("Sat, 19 Sep 2026 12:00:01 GMT", "rss-pubDate", now)).toMatchObject({ publishedAt: null, quality: "future" });
  });
});

describe("ordered-title story identity", () => {
  const candidate = (title: string, index: number, content?: string) => ({ articleUrl: `https://news.test/${index}`, relevanceScore: "0.5",
    qualityMetadata: { diversity: diversityFeatures(title, null, [], content) } as ArticleQuality });
  it.each([undefined, "", "Subscribe to our newsletter for more reporting."])("retains reversed actors/actions despite shared body %j", content => {
    const titles = ["Acme buys Beta after months of talks over disputed assets", "Beta buys Acme after months of talks over disputed assets"];
    const pool = titles.map((title, i) => candidate(title, i, content));
    expect(selectDiverse(pool, 10)).toHaveLength(2);
    expect(selectDiverse([...pool].reverse(), 10)).toEqual(selectDiverse(pool, 10));
  });
  it("preserves number roles and action order, but groups exact ordered copies", () => {
    const titles = ["Acme pays Beta 12 million after court orders final settlement", "Beta pays Acme 12 million after court orders final settlement",
      "Acme pays Beta 15 million after court orders final settlement", "ACME pays Beta 12 million after court orders final settlement!"];
    expect(selectDiverse(titles.map((title, i) => candidate(title, i, "")), 10)).toHaveLength(3);
  });
});

describe("real Intl.Segmenter quoted-ellipsis regressions", () => {
  it.each(["…”.", '...".', "…’.'", "...').", "…”)！", "...”?!", "…”.'", "...'."])("rejects incomplete quote suffix %s", suffix => {
    const text = `The researcher said, 'These early findings may indicate a possible benefit, but we must wait${suffix}`;
    expect(summarizeArticle(text)).toMatchObject({ summary: null, provenance: { method: "unavailable", spans: [] } });
    expect(summarizeArticle(text + " A later complete claim must never replace the opening context of this excerpt.").summary).toBeNull();
  });
  it("retains complete quoted attribution and exact span/hash input boundaries", () => {
    const text = 'The researcher said, “These early findings may indicate a benefit, but a controlled trial is still required.”';
    const result = summarizeArticle(`  ${text}  `, "page_body");
    expect(result.summary).toBe(text);
    expect(result.provenance.spans).toEqual([{ start: 2, end: text.length + 2 }]);
  });
});

it("exposes the complete personal-trend contract through IIndustryEngine", () => {
  expectTypeOf<Awaited<ReturnType<IIndustryEngine["getHotTrends"]>>>().toEqualTypeOf<PersonalTrend[]>();
});