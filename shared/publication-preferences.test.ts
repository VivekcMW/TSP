import { describe, expect, it } from "vitest";
import { legacyPublicationUrl, publicationCandidateSchema, publicationCandidatesSchema, reconcilePublicationCandidates, selectedPublicationCandidates } from "./publication-preferences";

describe("publication candidates", () => {
  it.each(["https://", "http://[", "not a url", "file:///etc/passwd", "javascript:alert(1)", "https://user:password@news.test/", `https://news.test/${"界".repeat(500)}`])("rejects invalid URLs without throwing: %s", url => {
    expect(publicationCandidateSchema.safeParse({ name: "News", url }).success).toBe(false);
    expect(legacyPublicationUrl(url)).toBeUndefined();
  });

  it("normalizes idempotently and enforces both encoded and raw bounds", () => {
    const candidate = publicationCandidateSchema.parse({ name: " News ", url: " https://NEWS.test/世界#fragment " });
    expect(candidate).toEqual({ name: "News", url: "https://news.test/%E4%B8%96%E7%95%8C" });
    expect(publicationCandidateSchema.parse(candidate)).toEqual(candidate);
    const prefix = "https://news.test/";
    const url = prefix + "x".repeat(2048 - prefix.length);
    expect(url).toHaveLength(2048);
    expect(publicationCandidateSchema.safeParse({ name: "News", url }).success).toBe(true);
    expect(publicationCandidateSchema.safeParse({ name: "News", url: url + "x" }).success).toBe(false);
  });

  it("retains valid siblings and never guesses domains from names", () => {
    expect(selectedPublicationCandidates(["https://", "A publication", "news.test", "https://news.test/"]))
      .toEqual([{ name: "news.test", url: "https://news.test/" }]);
    expect(selectedPublicationCandidates(["News", "Unselected"], [{ name: "News", url: "https://news.test/" }]))
      .toEqual([{ name: "News", url: "https://news.test/" }]);
  });

  it("rejects oversized lists before deduplication and retains first metadata", () => {
    const first = { name: "News", url: "https://news.test/" };
    expect(publicationCandidatesSchema.safeParse(Array(21).fill(first)).success).toBe(false);
    expect(publicationCandidatesSchema.parse([first, { name: " news ", url: "https://other.test/" }])).toEqual([first]);
    expect(reconcilePublicationCandidates([" news "], [first])).toEqual([first]);
    expect(reconcilePublicationCandidates([], [first])).toEqual([]);
  });
});