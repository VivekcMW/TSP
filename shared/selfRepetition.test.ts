import { describe, expect, it } from "vitest";
import { findSelfRepetitionMatches, selfRepetitionScore, SELF_REPETITION_THRESHOLD, type RepetitionCandidate } from "./selfRepetition";

describe("selfRepetitionScore", () => {
  it("scores identical text as a perfect match", () => {
    expect(selfRepetitionScore("Shipping fast matters more than shipping perfect.", "Shipping fast matters more than shipping perfect.")).toBe(1);
  });

  it("scores a near-verbatim repost with a tweaked opening above the threshold", () => {
    const original = "Shipping fast matters more than shipping perfect. Teams that ship weekly learn faster than teams that plan quarterly.";
    const repost = "Honestly, shipping fast matters more than shipping perfect. Teams that ship weekly learn faster than teams that plan quarterly.";
    expect(selfRepetitionScore(original, repost)).toBeGreaterThanOrEqual(SELF_REPETITION_THRESHOLD);
  });

  it("scores unrelated posts near zero", () => {
    const a = "Our quarterly earnings call is scheduled for next Thursday at 10am.";
    const b = "Five books I read this year that changed how I think about hiring.";
    expect(selfRepetitionScore(a, b)).toBeLessThan(SELF_REPETITION_THRESHOLD);
  });

  it("returns 0 for empty or stopword-only input rather than dividing by zero", () => {
    expect(selfRepetitionScore("", "Some real content here about launches.")).toBe(0);
    expect(selfRepetitionScore("the a an of to", "Some real content here about launches.")).toBe(0);
  });

  it("is symmetric", () => {
    const a = "The new pricing page ships this week with a simpler tier structure.";
    const b = "This week the new pricing page ships with a much simpler tier structure.";
    expect(selfRepetitionScore(a, b)).toBeCloseTo(selfRepetitionScore(b, a), 10);
  });
});

describe("findSelfRepetitionMatches", () => {
  const candidates: RepetitionCandidate[] = [
    { id: "old-1", content: "Shipping fast matters more than shipping perfect. Teams that ship weekly learn faster than teams that plan quarterly.", platform: "linkedin", publishedAt: new Date("2026-08-01"), updatedAt: new Date("2026-08-01") },
    { id: "old-2", content: "Five books I read this year that changed how I think about hiring.", platform: "linkedin", publishedAt: new Date("2026-08-15"), updatedAt: new Date("2026-08-15") },
  ];

  it("flags only the near-duplicate candidate, ranked by score", () => {
    const matches = findSelfRepetitionMatches("Honestly, shipping fast matters more than shipping perfect. Teams that ship weekly learn faster than teams that plan quarterly.", candidates);
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe("old-1");
    expect(matches[0].score).toBeGreaterThanOrEqual(SELF_REPETITION_THRESHOLD);
  });

  it("excludes the draft's own id so editing a draft never flags itself", () => {
    const matches = findSelfRepetitionMatches(candidates[0].content, candidates, "old-1");
    expect(matches).toEqual([]);
  });

  it("returns an empty list when nothing clears the threshold", () => {
    expect(findSelfRepetitionMatches("A completely unrelated announcement about office relocation.", candidates)).toEqual([]);
  });

  it("caps results to the requested limit", () => {
    const many: RepetitionCandidate[] = Array.from({ length: 5 }, (_, index) => ({
      id: `dup-${index}`, content: "Shipping fast matters more than shipping perfect. Teams that ship weekly learn faster than teams that plan quarterly.",
      platform: "linkedin", publishedAt: new Date(), updatedAt: new Date(),
    }));
    expect(findSelfRepetitionMatches("Shipping fast matters more than shipping perfect. Teams that ship weekly learn faster than teams that plan quarterly.", many, undefined, 2)).toHaveLength(2);
  });
});
