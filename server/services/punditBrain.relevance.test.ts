import { describe, expect, it, vi } from "vitest";
import { normalizeKeywords as normalizeProfileKeywords } from "@shared/profile-preferences";
vi.mock("./openRouter", () => ({ AIGenerationError: class extends Error {}, generateText: vi.fn(), generateTextWithMetadata: vi.fn() }));
vi.mock("./aiDiagnostics", () => ({ logAIInvalidOutputDiagnostic: vi.fn() }));
import { calculateArticleRelevance, normalizeKeywords } from "./punditBrain";
import { scoreArticleRelevance } from "./articleRelevance";

describe("legacy scoring delegates", () => {
  it("delegates normalization to the shared profile contract, preserving zero/category and dedup", () => {
    const input = [{ keyword: " AI ", weight: 0, category: "Infrastructure" }, "ai", "Cloud"];
    expect(normalizeKeywords(input)).toEqual(normalizeProfileKeywords(input));
    expect(normalizeKeywords(input)).toEqual([{ keyword: "AI", weight: 0, category: "Infrastructure" }, { keyword: "Cloud", weight: 0.7 }]);
  });

  it.each(["paid", "AI", `${"Background. ".repeat(100)} AI Cloud`, "ＣＬＯＵＤ\nAI"])("preserves the public return shape with exact shared scoring for %s", content => {
    const keywords = [{ keyword: "AI", weight: 0.9 }, { keyword: "Cloud", weight: 0.1, category: "My own topic" }];
    const result = scoreArticleRelevance({ title: "", content }, { keywords });
    expect(calculateArticleRelevance(content, keywords)).toEqual({ relevanceScore: result.relevanceScore, matchedKeywords: result.matchedKeywords, reasoning: result.relevanceReason });
  });

  it("does not assign evidence when all weights are zero or no interests exist", () => {
    expect(calculateArticleRelevance("AI", [{ keyword: "AI", weight: 0 }]).relevanceScore).toBe(0);
    expect(calculateArticleRelevance("AI", []).matchedKeywords).toEqual([]);
  });
});