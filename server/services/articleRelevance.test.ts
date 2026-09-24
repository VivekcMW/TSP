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
    expect(scoreArticleRelevance(article(content), { keywords: [keyword] }, { mode: "exact" }).relevanceScore > 0).toBe(matches);
  });

  it("does not manufacture a phrase by joining title and content", () => {
    expect(scoreArticleRelevance(article("learning", { title: "machine" }), { keywords: ["machine learning"] }, { mode: "exact" }).relevanceScore).toBe(0);
  });

  it("lets the default mode match a multi-word topic by its words, never as the exact phrase", () => {
    for (const [content, title] of [["machine advanced learning", ""], ["learning machine", ""], ["learning", "machine"]]) {
      const result = scoreArticleRelevance(article(content, { title }), { keywords: ["machine learning"] });
      expect(result.evidence).toEqual([expect.objectContaining({ label: "machine learning", matchKind: "words" })]);
    }
    expect(score("machine vision", { keywords: ["machine learning"] }).relevanceScore).toBe(0);
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
describe("topic words, market noise and name placement (default mode)", () => {
  const headline = (title: string, content = "") => article(content, { title });
  const topic = (keyword: string, weight = 0.9) => ({ keywords: [{ keyword, weight }] });

  it("counts a multi-word topic when its specific words appear, below an exact phrase", () => {
    const words = scoreArticleRelevance(headline("CTV measurement cannot stop at whether an ad was delivered"), topic("CTV Measurement Metrics"));
    expect(words.matchedKeywords).toEqual(["CTV Measurement Metrics"]);
    expect(words.evidence[0]).toMatchObject({ type: "keyword", matchKind: "words", field: "title", matchedSurface: "CTV" });
    expect(words.evidence[0].weight).toBeCloseTo(0.9 * 0.85, 6);
    const exact = scoreArticleRelevance(headline("CTV measurement metrics explained"), topic("CTV Measurement Metrics"));
    expect(exact.evidence[0]).toMatchObject({ matchKind: "exact", weight: 0.9 });
    expect(exact.relevanceScore).toBeGreaterThan(words.relevanceScore);
  });

  it("ignores plurals and generic qualifiers, but needs every specific word", () => {
    expect(scoreArticleRelevance(headline("When the CFO reviews the plan, attention metrics aren't enough"), topic("Attention Metric Standards")).matchedKeywords)
      .toEqual(["Attention Metric Standards"]);
    expect(scoreArticleRelevance(headline("Retail sales rise in the festive season"), topic("Retail Media Measurement")).relevanceScore).toBe(0);
  });

  it("needs two words of a multi-word topic, one of them in the headline", () => {
    expect(scoreArticleRelevance(headline("Brands fight for audience attention"), topic("Attention Metric Standards")).relevanceScore).toBe(0);
    expect(scoreArticleRelevance(headline("Festive season ad spends", "New CTV measurement currency"), topic("CTV Measurement Metrics")).relevanceScore).toBe(0);
  });

  it("never word-matches single-word topics, companies or people", () => {
    expect(scoreArticleRelevance(headline("Rajiv joins the Rajagopal family business"), { influencers: ["Rajiv Rajagopal"] }).relevanceScore).toBe(0);
    expect(scoreArticleRelevance(headline("Times Group results"), { companies: ["Times Internet"] }).relevanceScore).toBe(0);
  });

  it.each([
    "Magnite (MGNI) Stock May Be 11% Undervalued Following Fresh AI Ad News",
    "Trade Desk Falls 4% as Index-Removal Flows Keep Pressure On; Magnite Drops 3%",
    "Magnite shares hit a 52-week high after analyst upgrade",
    "Magnite Schedules Analyst and Investor Meeting on September 28",
    "Magnite announces board meeting to consider Q2 results",
    "Magnite AGM on October 5; record date set for dividend",
    "Magnite investor presentation: Q3 FY27 results",
  ])("halves a company-only match on market coverage: %s", title => {
    const result = scoreArticleRelevance(headline(title), { companies: ["Magnite"] });
    expect(result.relevanceScore).toBe(0.2059);
    expect(result.relevanceReason).toContain("stock-market coverage");
  });

  it.each(["Magnite launches a new CTV marketplace for Indian publishers", "Magnite results: what 30 publishers learned about attention"])
    ("does not treat ordinary company news as market coverage: %s", title => {
      expect(scoreArticleRelevance(headline(title), { companies: ["Magnite"] }).relevanceScore).toBe(0.4118);
    });

  it("keeps market coverage at full score when it also matches a topic", () => {
    const result = scoreArticleRelevance(headline("Magnite shares rise as CTV measurement improves"), { companies: ["Magnite"], ...topic("CTV Measurement Metrics") });
    expect(result.relevanceReason).not.toContain("stock-market coverage");
    expect(result.relevanceScore).toBeGreaterThan(0.5);
  });

  it("gives a name found only outside the headline half weight", () => {
    const passing = scoreArticleRelevance(headline("IIFA Awards 2027 to stream live worldwide on YouTube", "Zee will broadcast the ceremony."), { companies: ["Zee"] });
    expect(passing.evidence[0]).toMatchObject({ field: "content", weight: 0.35 });
    expect(scoreArticleRelevance(headline("Zee signs IIFA streaming deal"), { companies: ["Zee"] }).evidence[0]).toMatchObject({ field: "title", weight: 0.7 });
    // Without a headline there is nothing to prefer: full weight, as before.
    expect(score("Zee will broadcast the ceremony.", { companies: ["Zee"] }).evidence[0].weight).toBe(0.7);
  });

  it("ranks a topic story above company noise from the same search", () => {
    const profile = { companies: ["Magnite", "Zee"], keywords: [{ keyword: "CTV Measurement Metrics", weight: 0.9 }] };
    const topicStory = scoreArticleRelevance(headline("CTV measurement cannot stop at whether an ad was delivered"), profile).relevanceScore;
    for (const [title, content] of [["Magnite (MGNI) Stock May Be 11% Undervalued", ""], ["IIFA Awards 2027 to stream live on YouTube", "Zee will broadcast it."], ["Magnite promotes Brian Gephart to CFO", ""]]) {
      expect(topicStory).toBeGreaterThan(scoreArticleRelevance(headline(title, content), profile).relevanceScore);
    }
  });
});
