import { describe, expect, it } from "vitest";
import { scoreArticleRelevance } from "./articleRelevance";
import { DOMAIN_CONCEPTS } from "./articleConcepts";
const article = (content: string) => ({ title: "", content });
describe("bounded concept-v1 evidence", () => {
  it("uses guarded aliases once with exact original Unicode spans", () => {
    const input = "  The ＡＩ\t software model uses artificial intelligence.";
    const result = scoreArticleRelevance(article(input), { keywords: ["artificial intelligence", "AI"] });
    expect(result.evidence).toHaveLength(1);
    for (const evidence of result.evidence) expect(input.slice(evidence.span.start, evidence.span.end)).toBe(evidence.matchedSurface);
    expect(scoreArticleRelevance(article("AI software model"), { keywords: ["artificial intelligence"] }).evidence[0]).toMatchObject({ matchKind: "alias", matchedSurface: "AI", label: "artificial intelligence" });
  });
  it("does not expand ambiguous names, revive disabled aliases or recurse", () => {
    expect(DOMAIN_CONCEPTS.every(c => c.aliases.length <= 4)).toBe(true);
    expect(scoreArticleRelevance(article("Facebook and Sam"), { companies: ["Meta"], influencers: ["Sam Altman"] }).relevanceScore).toBe(0);
    expect(scoreArticleRelevance(article("AI software model"), { keywords: [{ keyword: "AI", weight: 0 }, "artificial intelligence"] }).relevanceScore).toBe(0);
    expect(scoreArticleRelevance(article("EV means enterprise value"), { keywords: ["electric vehicle"] }).relevanceScore).toBe(0);
  });
  it("preserves first-seen positive weight against later duplicate zero", () => {
    const result = scoreArticleRelevance(article("AI software model"), { keywords: [{ keyword: "artificial intelligence", weight: 0.8 }, { keyword: "Artificial intelligence", weight: 0 }] });
    expect(result.evidence[0].weight).toBe(0.8);
  });
  it("focus needs informative corroboration and cannot override explicit interest weight", () => {
    expect(scoreArticleRelevance(article("business growth success"), { focusDescription: "business growth success" }).relevanceScore).toBe(0);
    expect(scoreArticleRelevance(article("AI software model"), { focusDescription: "artificial intelligence" }).relevanceScore).toBe(0);
    expect(scoreArticleRelevance(article("AI and ML software models"), { focusDescription: "artificial intelligence and machine learning" }).evidence).toHaveLength(2);
    const result = scoreArticleRelevance(article("artificial intelligence software"), { keywords: [{ keyword: "AI", weight: 0.9 }], focusDescription: "artificial intelligence" });
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ type: "keyword", weight: 0.9 });
  });
  it("focus-only without retrieval provenance is not source selection", () => {
    expect(scoreArticleRelevance({ ...article("unrelated sports"), userSourceProvenance: { kind: "active-user-source", sourceId: "source" } }, { focusDescription: "business growth" }).relevanceScore).toBe(0);
  });
});

// Held-out synthetic reporting examples, authored AFTER freezing concept-v1.
// Not a representative external benchmark; no vocabulary tuning from these labels.
const heldOut = [
  ["artificial intelligence", "Artificial intelligence improves weather forecasts.", true],
  ["artificial intelligence", "AI software models forecast storm tracks.", true],
  ["artificial intelligence", "Ai won the regional chess final.", false],
  ["machine learning", "Machine learning identifies faults in turbines.", true],
  ["machine learning", "ML training algorithms detect turbine faults.", true],
  ["machine learning", "The bottle holds 250 ml of water.", false],
  ["electric vehicle", "Electric vehicle registrations rose this quarter.", true],
  ["electric vehicle", "EV charging queues grow at highway stops.", true],
  ["electric vehicle", "EV refers to enterprise value in this valuation.", false],
  ["randomized controlled trial", "A randomized controlled trial enrolled 40 adults.", true],
  ["randomized controlled trial", "The RCT enrolled patients at three clinics.", true],
  ["randomized controlled trial", "RCT is the local rowing club team.", false],
  ["digital out of home", "Digital out of home advertising grew in stations.", true],
  ["digital out of home", "DOOH billboard screens now carry the campaign.", true],
  ["digital out of home", "The artist signed the painting DOOH.", false],
  ["AI", "Ai won the regional chess final.", false],
  ["Meta", "The essay examines meta analysis rather than a company.", false],
  ["cloud", "The cloud software subscription was renewed.", true],
] as const;
it("reports exact baseline versus concepts on held-out labels, including retained lexical ambiguity", () => {
  const evaluate = (mode: "exact" | "concept") => {
    const scored = heldOut.map(([keyword, content, relevant], index) => ({ relevant, index, score: scoreArticleRelevance(article(content), { keywords: [keyword] }, { mode }).relevanceScore }));
    const positives = scored.filter(r => r.relevant).length;
    const selected = scored.filter(r => r.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
    const tp = selected.filter(r => r.relevant).length;
    let hits = 0;
    const ap = selected.reduce((sum, row, index) => row.relevant ? sum + (++hits / (index + 1)) : sum, 0) / positives;
    return { precision: tp / selected.length, recall: tp / positives, averagePrecision: ap, ambiguityFalsePositives: selected.length - tp };
  };
  const baseline = evaluate("exact"), concepts = evaluate("concept");
  console.info("HELD_OUT_CONCEPT_METRICS", JSON.stringify({ examples: heldOut.length, baseline, concepts }));
  expect(baseline).toEqual({ precision: 0.75, recall: 6 / 11, averagePrecision: (5 + 6 / 8) / 11, ambiguityFalsePositives: 2 });
  expect(concepts).toEqual({ precision: 11 / 13, recall: 1, averagePrecision: (10 + 11 / 13) / 11, ambiguityFalsePositives: 2 });
});