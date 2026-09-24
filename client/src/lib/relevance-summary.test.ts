import { describe, expect, it } from "vitest";
import { relevanceSummary } from "./relevance-summary";

const evidence = (type: "keyword" | "company" | "influencer" | "focus", label: string) => ({ type, label });
const item = (parts: Partial<{ evidence: ReturnType<typeof evidence>[]; relevanceReason: string | null; matchedKeywords: string[] }>) => ({
  relevanceReason: parts.relevanceReason ?? null,
  matchedKeywords: parts.matchedKeywords ?? [],
  qualityMetadata: parts.evidence ? { relevance: { version: "concept-v1", evidence: parts.evidence } } : null,
});

describe("why a story is in Discover, in plain words", () => {
  it("names the companies and people the customer follows", () => {
    expect(relevanceSummary(item({ evidence: [evidence("company", "DGTOOHL"), evidence("company", "Hero MotoCorp")] })))
      .toBe("Mentions DGTOOHL and Hero MotoCorp, companies you follow.");
    expect(relevanceSummary(item({ evidence: [evidence("influencer", "Bill Harvey")] }))).toBe("Mentions Bill Harvey, who you follow.");
  });

  it("leads with topics and keeps long lists short", () => {
    expect(relevanceSummary(item({ evidence: [evidence("company", "Magnite"), evidence("keyword", "CTV Measurement Metrics"), evidence("keyword", "Retail Media"),
      evidence("keyword", "Attention"), evidence("keyword", "FAST Channels")] })))
      .toBe("Matches your topics CTV Measurement Metrics, Retail Media, Attention and 1 more. Mentions Magnite, a company you follow.");
  });

  it("says why market coverage ranks lower", () => {
    expect(relevanceSummary(item({ evidence: [evidence("company", "Magnite")], relevanceReason: 'Matched article text: company "Magnite". Ranked lower: stock-market coverage that matched only a company or person.' })))
      .toBe("Mentions Magnite, a company you follow. Ranked lower because it's stock-market coverage.");
  });

  it("reads older stories from their stored reason, never showing the raw text", () => {
    expect(relevanceSummary(item({ relevanceReason: 'Matched article text: influencer "Ada Lovelace"; keyword "AI"; company "Meta".' })))
      .toBe("Matches your topic AI. Mentions Meta, a company you follow. Mentions Ada Lovelace, who you follow.");
    expect(relevanceSummary(item({ relevanceReason: "Selected from an active user source; no positive textual interests configured. This is source selection, not a topic match." })))
      .toBe("From one of your saved sources.");
    expect(relevanceSummary(item({ matchedKeywords: ["AI", "Cloud"] }))).toBe("Matches AI and Cloud.");
    expect(relevanceSummary(item({}))).toBeNull();
    expect(relevanceSummary(item({ relevanceReason: "", matchedKeywords: ["AI"] }))).toBeNull();
  });
});
