import { describe, expect, it } from "vitest";
import { MAX_DRAFT_CHARACTERS, platformTextLength, platformTextValidation, trimLinkPunctuation } from "./editorial";

describe("platform text length", () => {
  const link = `https://news.test/${"story-".repeat(15)}trial`;
  it("counts each link as 23 characters on X", () => {
    expect(platformTextLength(`${"a".repeat(250)} ${link}`, "twitter")).toBe(250 + 1 + 23);
    expect(platformTextLength(`${link} and ${link}`, "twitter")).toBe(23 + 5 + 23);
  });
  it("counts sentence punctuation after an X link as text, not link", () => {
    expect(platformTextLength(`See ${link}.`, "twitter")).toBe(4 + 23 + 1);
  });
  it("counts links at full length elsewhere", () => {
    expect(platformTextLength(`${"a".repeat(250)} ${link}`, "threads")).toBe(251 + link.length);
  });
});

describe("shared platform bounds and independent storage cap", () => {
  it.each(["", " ", "\n\t\u2003"])("rejects blank %j even with a zero minimum", content => {
    expect(platformTextValidation(content, "twitter", 280, 0).error).toContain("nonblank");
  });
  it.each([
    ["😀", 2], ["漢字", 2], ["e\u0301", 2], ["👩‍💻", 5], ["é", 1],
  ])("retains the existing UTF-16 Unicode contract for %s", (content, length) => {
    for (const platform of ["twitter", "linkedin", "bluesky"]) {
      expect(platformTextLength(content as string, platform)).toBe(length);
      expect(platformTextValidation(content as string, platform, length as number, length as number).error).toBeNull();
      expect(platformTextValidation(content as string, platform, (length as number) - 1).error).toContain("Too long");
      expect(platformTextValidation(content as string, platform, 280, (length as number) + 1).error).toContain("at least");
    }
  });
  it("applies min and max to multiple weighted URLs, retaining whitespace and punctuation", () => {
    const text = `https://news.test/${"long".repeat(100)}.\nhttp://other.test/a!`;
    expect(platformTextValidation(text, "twitter", 49, 49)).toMatchObject({ length: 49, rawLength: text.length, error: null });
    expect(platformTextValidation(text, "twitter", 48).error).toContain("49/48");
    expect(platformTextValidation(text, "twitter", 280, 50).error).toContain("at least 50");
  });
  it("separates raw 5000/5001 from a valid weighted X count without modifying text", () => {
    const text = `https://a.test/${"x".repeat(MAX_DRAFT_CHARACTERS - "https://a.test/".length)}`;
    expect(platformTextValidation(text, "twitter", 280)).toMatchObject({ length: 23, rawLength: 5000, error: null });
    expect(platformTextValidation(`${text}x`, "twitter", 280)).toMatchObject({ length: 23, rawLength: 5001 });
    expect(platformTextValidation(`${text}x`, "twitter", 280).error).toContain("Application storage limit");
    expect(platformTextValidation("x".repeat(5000), "reddit", 5000).error).toBeNull();
    expect(platformTextValidation("x".repeat(5001), "reddit", 5000).error).toContain("Application storage limit");
  });
  it.each([279, 280, 281])("enforces the X boundary at %i including a long URL", length => {
    const text = `${"x".repeat(length - 24)} https://a.test/${"b".repeat(800)}`;
    expect(platformTextLength(text, "twitter")).toBe(length);
    expect(platformTextValidation(text, "twitter", 280).error === null).toBe(length <= 280);
  });
});

describe("link punctuation", () => {
  it.each([["https://a.test/x.", "https://a.test/x"], ["https://a.test/x),", "https://a.test/x"], ["https://a.test/x\u201D", "https://a.test/x"], ["https://a.test/x", "https://a.test/x"]])("trims %s to %s", (raw, trimmed) => {
    expect(trimLinkPunctuation(raw)).toBe(trimmed);
  });
});
