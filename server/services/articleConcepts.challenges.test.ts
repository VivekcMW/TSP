import { describe, expect, it } from "vitest";
import { scoreArticleRelevance } from "./articleRelevance";
import { DOMAIN_CONCEPTS } from "./articleConcepts";

// Review regressions/challenges, NOT additions to the frozen held-out evaluation.
const score = (content: string, profile: Parameters<typeof scoreArticleRelevance>[1]) => scoreArticleRelevance({ title: "", content }, profile);
describe("concept-v1 review challenges (not a benchmark)", () => {
  it.each([
    ["artificial intelligence", "automated reasoning"], ["machine learning", "statistical prediction"],
    ["electric vehicle", "BEV charging infrastructure"], ["large language model", "foundation models"],
    ["Meta", "Facebook"],
  ])("does not invent unsupported alias %s -> %s", (keyword, content) => {
    expect(score(content, { keywords: [keyword] })).toMatchObject({ relevanceScore: 0, evidence: [] });
  });
  it.each([
    ["artificial intelligence", "Ai won a chess tournament.", "Ai models a jacket at the fashion show."],
    ["machine learning", "The bottle contains 250 ml of water.", "The training manual requires 250 ml of water."],
    ["electric vehicle", "EV means enterprise value.", "EV is enterprise value for a battery manufacturer."],
    ["randomized controlled trial", "RCT is our rowing club team.", "RCT club members brought patients gifts."],
  ])("documents lexical context limits for %s, not entity disambiguation", (keyword, plain, contextual) => {
    expect(score(plain, { keywords: [keyword] }).relevanceScore).toBe(0);
    // Domain words elsewhere can license an unrelated acronym sense. This is a
    // known limitation, not evidence of accuracy or grounds to tune held-out data.
    const result = score(contextual, { keywords: [keyword] });
    if (keyword === "artificial intelligence") {
      // 'models' is not the guarded complete word 'model'.
      expect(result.relevanceScore).toBe(0);
      expect(score("Ai is a fashion model.", { keywords: [keyword] }).relevanceScore).toBeGreaterThan(0);
    } else expect(result.relevanceScore).toBeGreaterThan(0);
  });
  it("preserves zero/first-seen weights and blocks focus resurrection through aliases", () => {
    for (const keyword of ["AI", "artificial intelligence"]) {
      const result = score("AI software and machine learning", { keywords: [{ keyword, weight: 0 }, { keyword, weight: 1 }], focusDescription: "artificial intelligence and machine learning" });
      expect(result.relevanceScore).toBe(0); // Only one focus concept remains.
    }
    expect(score("AI software", { keywords: [{ keyword: "AI", weight: 0 }, "artificial intelligence"], companies: ["AI"] }).evidence)
      .toEqual([expect.objectContaining({ type: "company", label: "AI", weight: 0.7, matchKind: "exact" })]);
  });
  it("caps derived focus at .3 raw weight and keeps explicit contributions separate", () => {
    const text = DOMAIN_CONCEPTS.map(c => c.label).join("; ");
    const result = score(text, { focusDescription: text });
    expect(result.evidence).toHaveLength(3);
    expect(result.evidence.every(e => e.type === "focus")).toBe(true);
    expect(result.evidence.reduce((sum, e) => sum + e.weight, 0)).toBeCloseTo(0.3);
    expect(result.relevanceScore).toBe(0.2308);
    const mixed = score(text + "; Acme", { companies: ["Acme"], focusDescription: text });
    expect(mixed.evidence.filter(e => e.type === "focus")).toHaveLength(3);
    expect(mixed.relevanceScore).toBe(0.5);
    expect(score("electric vehicle and randomized controlled trial", { focusDescription: text }).relevanceScore).toBe(0); // Beyond six focus concepts.
  });
});