import { describe, expect, it } from "vitest";
import { scoreArticleRelevance, type RelevanceProfile } from "./articleRelevance";
import type { FetchedArticle } from "./engines/types";

const article = (title: string, content = ""): FetchedArticle => ({ title, content, link: "https://news.test/story", source: "Wire", categories: [], pubDate: "" });
const profile: RelevanceProfile = {
  keywords: [{ keyword: "Retail media", weight: 0.7 }, { keyword: "CTV", weight: 1 }, { keyword: "Brand safety", weight: 0.4 }],
  companies: ["Acme Corp"], focusDescription: "I advise D2C brands on retail media and connected TV.",
};
const fixtures = [
  article("Retail media budgets grow"), article("CTV measurement gets a standard", "Acme Corp signs on."),
  article("Brand safety in retail media networks"), article("Weather today"), article("Media for retail brands grows", "connected TV ad spend rises"),
];

describe("learned keyword adjustments in relevance scoring", () => {
  it("scores exactly as before when there is nothing learned", () => {
    for (const item of fixtures) {
      const baseline = scoreArticleRelevance(item, profile);
      expect(scoreArticleRelevance(item, profile, {})).toEqual(baseline);
      expect(scoreArticleRelevance(item, profile, { keywordAdjustments: {} })).toEqual(baseline);
      expect(scoreArticleRelevance(item, profile, { keywordAdjustments: { "Not a profile topic": -0.6, CTV: 0 } })).toEqual(baseline);
    }
  });

  it("multiplies the matched topic's weight by (1 + delta) and keeps scores in range", () => {
    const item = fixtures[2];
    const baseline = scoreArticleRelevance(item, profile);
    const less = scoreArticleRelevance(item, profile, { keywordAdjustments: { "retail MEDIA": -0.6 } });
    const more = scoreArticleRelevance(item, profile, { keywordAdjustments: { "Retail media": 0.4 } });
    expect(less.evidence.find(entry => entry.label === "Retail media")?.weight).toBeCloseTo(0.7 * 0.4);
    expect(more.evidence.find(entry => entry.label === "Retail media")?.weight).toBeCloseTo(0.98);
    expect(less.evidence.find(entry => entry.label === "Brand safety")?.weight).toBe(0.4);
    expect(less.relevanceScore).toBeLessThan(baseline.relevanceScore);
    expect(more.relevanceScore).toBeGreaterThan(baseline.relevanceScore);
    expect(less.matchedKeywords).toEqual(baseline.matchedKeywords);
    for (const result of [less, more]) {
      expect(result.relevanceScore).toBeGreaterThan(0);
      expect(result.relevanceScore).toBeLessThan(1);
    }
  });

  it("clamps out-of-range deltas and never lifts a weight above 1", () => {
    const item = fixtures[1];
    const clamped = scoreArticleRelevance(item, profile, { keywordAdjustments: { CTV: -5 } });
    expect(clamped).toEqual(scoreArticleRelevance(item, profile, { keywordAdjustments: { CTV: -0.6 } }));
    const boosted = scoreArticleRelevance(item, profile, { keywordAdjustments: { CTV: 3 } });
    expect(boosted.evidence.find(entry => entry.label === "CTV")?.weight).toBe(1);
    expect(boosted.relevanceScore).toBe(scoreArticleRelevance(item, profile).relevanceScore);
  });

  it("applies to companies and to topics matched by their words", () => {
    const named = scoreArticleRelevance(fixtures[1], profile).evidence.find(entry => entry.label === "Acme Corp")!;
    const company = scoreArticleRelevance(fixtures[1], profile, { keywordAdjustments: { "Acme Corp": -0.5 } });
    expect(company.evidence.find(entry => entry.label === "Acme Corp")?.weight).toBeCloseTo(named.weight * 0.5);
    const words = scoreArticleRelevance(fixtures[4], profile);
    const lowered = scoreArticleRelevance(fixtures[4], profile, { keywordAdjustments: { "Retail media": -0.5 } });
    const before = words.evidence.find(entry => entry.label === "Retail media");
    expect(before?.matchKind).toBe("words");
    expect(lowered.evidence.find(entry => entry.label === "Retail media")?.weight).toBeCloseTo(before!.weight * 0.5);
  });
});
