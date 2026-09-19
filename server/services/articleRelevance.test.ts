import { describe, expect, it } from "vitest";
import { RELEVANCE_LIMITS, scoreArticleRelevance, type RelevanceProfile } from "./articleRelevance";
import type { FetchedArticle } from "./engines/types";

const article = (content: string, extra: Partial<FetchedArticle> = {}): FetchedArticle => ({
  title: "", content, link: "https://news.test/story", source: "", categories: [], pubDate: "", ...extra,
});
const ownSource = { userSourceProvenance: { kind: "active-user-source" as const, sourceId: "source-1" } };
const score = (content: string, profile: RelevanceProfile) => scoreArticleRelevance(article(content), profile);

describe("deterministic lexical relevance", () => {
  it.each([0.00001, Number.MIN_VALUE])("preserves positive evidence at tiny weight %s", weight => {
    const result = score("AI", { keywords: [{ keyword: "AI", weight }] });
    expect(result.relevanceScore).toBe(0.0001);
    expect(result.matchedKeywords).toEqual(["AI"]);
  });

  it("orders weighted evidence and never decreases when a low-weight match is added", () => {
    const profile = { keywords: [{ keyword: "Cloud", weight: 1 }, { keyword: "AI", weight: 0.1 }] };
    expect(score("Cloud", profile).relevanceScore).toBe(0.5);
    expect(score("AI", profile).relevanceScore).toBe(0.0909);
    expect(score("Cloud AI", profile).relevanceScore).toBe(0.5238);
    expect(score("Cloud AI", profile).relevanceScore).toBeGreaterThan(score("Cloud", profile).relevanceScore);
  });

  it("ignores zero-weight matches and does not mutate or drop arbitrary categories", () => {
    const keywords = Object.freeze([Object.freeze({ keyword: "AI", weight: 0, category: "Infrastructure" }), "Cloud"]);
    const result = score("AI Cloud", { keywords });
    expect(result.matchedKeywords).toEqual(["Cloud"]);
    expect(result.relevanceScore).toBe(0.4118);
    expect(keywords[0]).toEqual({ keyword: "AI", weight: 0, category: "Infrastructure" });
  });

  it("uses first-seen keyword metadata including zero, without duplicate inflation", () => {
    expect(score("AI", { keywords: [{ keyword: "AI", weight: 0 }, { keyword: "ai", weight: 1 }] }).relevanceScore).toBe(0);
    const result = score("AI AI AI", { keywords: [{ keyword: "AI", weight: 0.3 }, { keyword: "ai", weight: 1 }] });
    expect(result.relevanceScore).toBe(0.2308);
    expect(result.matchedKeywords).toEqual(["AI"]);
  });

  it("deduplicates NFKC/case/whitespace variants across all three types", () => {
    const result = score("AI policy", { keywords: [{ keyword: " ＡＩ\tpolicy ", weight: 0.2 }, "ai POLICY"], companies: ["AI policy"], influencers: ["ai policy"] });
    expect(result.evidence).toEqual([{ label: "AI policy", type: "keyword", weight: 0.2,
      matchKind: "exact", matchedSurface: "AI policy", field: "content", span: { start: 0, end: 9 } }]);
    expect(result.relevanceScore).toBe(0.1667);
  });

  it("gives companies and influencers positive default evidence and explains exact labels/types", () => {
    const result = score("Meta and Ada Lovelace discuss AI.", { companies: ["Meta"], influencers: ["Ada Lovelace"], keywords: ["AI"] });
    expect(result.matchedKeywords).toEqual(["Ada Lovelace", "AI", "Meta"]);
    expect(result.relevanceScore).toBe(0.6774);
    expect(result.relevanceReason).toBe('Matched article text: influencer "Ada Lovelace"; keyword "AI"; company "Meta".');
    expect(result.evidence.map(item => item.label)).toEqual(result.matchedKeywords);
    expect(result.relevanceReason).not.toMatch(/%|confidence/i);
  });

  it("allows positive company evidence for a keyword disabled at zero without counting twice", () => {
    const result = score("Meta", { keywords: [{ keyword: "Meta", weight: 0 }], companies: ["Meta"], influencers: ["meta"] });
    expect(result.evidence).toEqual([{ label: "Meta", type: "company", weight: 0.7,
      matchKind: "exact", matchedSurface: "Meta", field: "content", span: { start: 0, end: 4 } }]);
  });

  it.each([
    ["AI", "paid aid railway", false], ["Meta", "metadata metaverse", false],
    ["machine learning", "machine advanced learning", false], ["machine learning", "learning machine", false],
    ["machine learning", "machine\n\t learning", true], ["AI", "(AI), ai!", true],
    ["AI", "éAI AIé AI_ _AI AI2 2AI", false], ["AI", "AI\u0301", false],
    ["café", "CAFE\u0301", true], ["ＡＩ", "ai", true], ["AI", "ＡＩ", true],
    ["東京", "「東京」", true], ["東京", "東京都", false],
    ["C++", "Use C++ today.", true], ["C++", "XC++ C++17", false],
    [".NET", "Try (.NET), today.", true], [".NET", "ASP.NET .NETCore", false],
    ["C#", "C# and F#", true], ["a.b", "aXb", false], ["[AI]", "Use [AI].", true],
  ])("matches full Unicode/punctuation phrases: %s in %s -> %s", (keyword, content, matches) => {
    expect(score(content, { keywords: [keyword] }).relevanceScore > 0).toBe(matches);
  });

  it("does not manufacture a phrase by joining title and content", () => {
    expect(scoreArticleRelevance(article("learning", { title: "machine" }), { keywords: ["machine learning"] }).relevanceScore).toBe(0);
  });

  it("considers full content beyond 500 characters and title-only evidence", () => {
    expect(score(`${"Background. ".repeat(100)} AI`, { keywords: ["AI"] }).matchedKeywords).toEqual(["AI"]);
    expect(scoreArticleRelevance(article("", { title: "AI news" }), { keywords: ["AI"] }).matchedKeywords).toEqual(["AI"]);
  });

  it("bounds content and title without creating matches in cut-off words", () => {
    const content = `${" ".repeat(RELEVANCE_LIMITS.content - 2)}AIs`;
    expect(score(content, { keywords: ["AI"] }).relevanceScore).toBe(0);
    expect(score(`${"x ".repeat(RELEVANCE_LIMITS.content)} AI`, { keywords: ["AI"] }).relevanceScore).toBe(0);
    expect(scoreArticleRelevance(article("", { title: `${" ".repeat(RELEVANCE_LIMITS.title - 2)}AIs` }), { keywords: ["AI"] }).relevanceScore).toBe(0);
  });

  it.each([NaN, Infinity, -Infinity, -0.1, 1.1])("fails closed for a non-finite/out-of-range weight (%s)", weight => {
    const result = scoreArticleRelevance(article("AI", ownSource), { keywords: [{ keyword: "AI", weight }] });
    expect(result.relevanceScore).toBe(0);
    expect(result.relevanceReason).toContain("Invalid or oversized");
  });

  it.each([
    { keywords: ["x".repeat(101)] }, { companies: ["x".repeat(101)] },
    { influencers: Array(101).fill("Ada") }, { keywords: Array(101).fill("AI") },
    { keywords: [{ keyword: "AI", category: "x".repeat(101) }] },
  ])("fails closed for oversized signals without source fallback (%#)", profile => {
    expect(scoreArticleRelevance(article("AI Ada", ownSource), profile).relevanceScore).toBe(0);
  });

  it("has deterministic lexical evidence order independent of distinct input order", () => {
    expect(score("AI Cloud", { keywords: ["Cloud", "AI"] })).toEqual(score("AI Cloud", { keywords: ["AI", "Cloud"] }));
  });

  it("returns no matches without filling with irrelevant articles", () => {
    expect(score("Sports results", { keywords: ["AI"] })).toEqual({ relevanceScore: 0, matchedKeywords: [], evidence: [],
      relevanceReason: "No configured positive keyword, company or influencer phrases matched the article text." });
  });
});

describe("source-only selection", () => {
  it("selects only trusted active-source provenance, not source names, URLs or category text", () => {
    const raw = article("Sports results", { source: "Selected publication", categories: ["user-source"] });
    expect(scoreArticleRelevance(raw, {}).relevanceScore).toBe(0);
    const result = scoreArticleRelevance({ ...raw, ...ownSource }, {});
    expect(result.relevanceScore).toBe(0.1);
    expect(result.matchedKeywords).toEqual([]);
    expect(result.evidence).toEqual([]);
    expect(result.relevanceReason).toContain("active user source");
    expect(result.relevanceReason).toContain("not a topic match");
  });

  it.each([{ keywords: ["AI"] }, { companies: ["Meta"] }, { influencers: ["Ada Lovelace"] }])(
    "does not select an unmatched own-source article when positive signals exist (%#)", profile => {
      expect(scoreArticleRelevance(article("Sports results", ownSource), profile).relevanceScore).toBe(0);
    },
  );

  it("permits source-only selection with exclusively zero-weight keywords", () => {
    expect(scoreArticleRelevance(article("Sports results", ownSource), { keywords: [{ keyword: "AI", weight: 0 }] }).relevanceScore).toBe(0.1);
  });

  it("does not boost a textual match merely because it was fetched from an own source", () => {
    expect(scoreArticleRelevance(article("AI", ownSource), { keywords: ["AI"] })).toEqual(score("AI", { keywords: ["AI"] }));
  });

  it("rejects empty provenance identifiers", () => {
    expect(scoreArticleRelevance(article("", { userSourceProvenance: { kind: "active-user-source", sourceId: " " } }), {}).relevanceScore).toBe(0);
  });
});