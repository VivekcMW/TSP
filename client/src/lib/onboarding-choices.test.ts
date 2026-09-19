import { describe, expect, it } from "vitest";
import { profileKeywordsSchema } from "@shared/profile-preferences";
import { normalizeOnboardingKeywords, normalizeOnboardingPublications, normalizeOnboardingRecommendations } from "./onboarding-choices";

describe("onboarding publication suggestions", () => {
  it("validates candidates individually, preserving names with bad URLs and canonicalizing matching names", () => {
    expect(normalizeOnboardingPublications([" Legacy ", " Match ", null, " ", "x".repeat(101)], [
      null, false, {}, { name: " ", url: "https://empty.invalid" },
      { name: "Broken", url: "not a URL" }, { name: "Script", url: "javascript:alert(1)" },
      { name: "Credentials", url: "https://user:pass@site.invalid" },
      { name: "match", url: " https://match.invalid/path#fragment " },
      { name: "MATCH", url: "https://duplicate.invalid" },
      { name: "Candidate only", url: "http://only.invalid" },
      { name: "x".repeat(101), url: "https://long.invalid" },
    ])).toEqual({
      publications: ["Legacy", "Match", "Broken", "Script", "Credentials", "Candidate only"],
      publicationCandidates: [{ name: "Match", url: "https://match.invalid/path" }, { name: "Candidate only", url: "http://only.invalid/" }],
    });
  });

  it("caps valid selected names and their metadata at 20 without guessing missing URLs", () => {
    const candidates = Array.from({ length: 25 }, (_, i) => ({ name: `Publication ${i}`, url: `https://source${i}.invalid` }));
    const result = normalizeOnboardingPublications(["Legacy", " legacy ", "example.invalid"], candidates);
    expect(result.publications).toHaveLength(20);
    expect(result.publicationCandidates).toHaveLength(18);
    expect(result.publicationCandidates.at(-1)?.name).toBe("Publication 17");
    expect(normalizeOnboardingPublications(null, {})).toEqual({ publications: [], publicationCandidates: [] });
  });
});

describe("onboarding keyword suggestions", () => {
  it("preserves zero weights and arbitrary bounded categories alongside legacy strings", () => {
    expect(normalizeOnboardingKeywords([
      { keyword: "  Cloud  ", weight: 0, category: "Infrastructure" },
      " Legacy ", { keyword: "Models", weight: 1, category: "AI" },
      { keyword: "Default weight", category: "Infrastructure" },
      { keyword: "cloud", weight: 0.9, category: "AI" },
    ])).toEqual([
      { keyword: "Cloud", weight: 0, category: "Infrastructure" },
      { keyword: "Legacy", weight: 0.7 },
      { keyword: "Models", weight: 1, category: "AI" },
      { keyword: "Default weight", weight: 0.7, category: "Infrastructure" },
    ]);
  });

  it("rejects each malformed suggestion without coercing or clamping metadata", () => {
    expect(normalizeOnboardingKeywords([
      null, false, 12, [], {}, " ", "x".repeat(101),
      { keyword: "blank weight", weight: null },
      { keyword: "string weight", weight: "0" },
      { keyword: "negative", weight: -0.1 }, { keyword: "too high", weight: 1.1 },
      { keyword: "infinite", weight: Infinity }, { keyword: "nan", weight: NaN },
      { keyword: "bad category", category: 1 },
      { keyword: "empty category", category: " " },
      { keyword: "long category", category: "x".repeat(101) },
      { keyword: "Valid", weight: 0, category: "Infrastructure", ignored: true },
    ])).toEqual([{ keyword: "Valid", weight: 0, category: "Infrastructure" }]);
  });

  it.each([null, undefined, "wrong shape", { keyword: "not a list" }, 42])("handles a non-array keyword value: %j", (value) => {
    expect(normalizeOnboardingKeywords(value)).toEqual([]);
  });

  it("caps valid unique suggestions at 20 without making server payload validation permissive", () => {
    const suggestions = [null, "First", "first", ...Array.from({ length: 30 }, (_, i) => ({ keyword: `Topic ${i}`, weight: 0 }))];
    const result = normalizeOnboardingKeywords(suggestions);
    expect(result).toHaveLength(20);
    expect(result[19]).toEqual({ keyword: "Topic 18", weight: 0 });
    expect(profileKeywordsSchema.safeParse(result).success).toBe(true);
    expect(profileKeywordsSchema.safeParse(Array(21).fill("duplicate")).success).toBe(false);
  });

  it("validates unknown response envelopes and bounds the optional industry", () => {
    for (const value of [null, [], "not an object", 1]) {
      expect(() => normalizeOnboardingRecommendations(value)).toThrow();
    }
    expect(normalizeOnboardingRecommendations({
      publications: [null, " Publication "], keywords: ["Legacy"],
      personalities: ["Leader"], companies: false,
      recommendedEngine: { industry: "x".repeat(101) },
    })).toEqual({
      publications: ["Publication"], keywords: [{ keyword: "Legacy", weight: 0.7 }],
      influencers: ["Leader"], companies: [], recommendedIndustry: undefined,
    });
    expect(normalizeOnboardingRecommendations({ recommendedEngine: { industry: "technology_saas" } }).recommendedIndustry).toBe("technology_saas");
    expect(normalizeOnboardingRecommendations({ recommendedEngine: { industry: "technology-saas" } }).recommendedIndustry).toBeUndefined();
  });
});