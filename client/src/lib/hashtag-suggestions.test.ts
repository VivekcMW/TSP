import { describe, expect, it } from "vitest";
import { suggestHashtags } from "./hashtag-suggestions";

describe("suggestHashtags", () => {
  it("returns no suggestions for platforms that don't use hashtags", () => {
    expect(suggestHashtags("A long Medium essay about Open Source funding.", "medium")).toEqual([]);
    expect(suggestHashtags("Something about Open Source funding.", "reddit")).toEqual([]);
  });

  it("prioritizes repeated capitalized multi-word phrases as hashtags", () => {
    const content = "Open Source funding is changing. More companies are backing Open Source projects than ever, and Open Source maintainers benefit.";
    const result = suggestHashtags(content, "linkedin");
    expect(result).toContain("#OpenSource");
  });

  it("caps suggestions to the platform's conventional hashtag count", () => {
    const content = "Artificial Intelligence and Machine Learning and Open Source and Climate Change and Public Health all matter a great deal to many people worldwide today.";
    const result = suggestHashtags(content, "twitter");
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("excludes hashtags already present in the content", () => {
    const content = "Open Source #OpenSource momentum keeps building as Open Source adoption grows.";
    const result = suggestHashtags(content, "linkedin");
    expect(result).not.toContain("#OpenSource");
  });

  it("falls back to frequent significant lowercase words when no strong phrase exists", () => {
    const content = "This covers funding rounds for new startups. Many founders discuss funding constantly, because funding fundamentally drives growth.";
    const result = suggestHashtags(content, "linkedin");
    expect(result).toContain("#funding");
  });

  it("returns an empty array for blank content", () => {
    expect(suggestHashtags("   ", "linkedin")).toEqual([]);
  });

  it("ignores URLs when extracting candidate terms", () => {
    const content = "Check this out: https://example.com/Open-Source-Report for more Open Source Open Source details.";
    const result = suggestHashtags(content, "linkedin");
    expect(result.some(tag => tag.toLowerCase().includes("examplecom"))).toBe(false);
  });
});
