import { describe, expect, it } from "vitest";
import { applyUnicodeStyle, clearUnicodeStyles, formatAsList, postStats, tidySpacing, LINKEDIN_POST_MAX_CHARACTERS } from "./linkedin-formatter";

describe("LinkedIn formatter", () => {
  it("styles letters and digits and leaves everything else alone", () => {
    expect(applyUnicodeStyle("Hello 2026!", "bold")).toBe("𝗛𝗲𝗹𝗹𝗼 𝟮𝟬𝟮𝟲!");
    expect(applyUnicodeStyle("Hi", "italic")).toBe("𝘏𝘪");
    expect(applyUnicodeStyle("Hi", "boldItalic")).toBe("𝙃𝙞");
    expect(applyUnicodeStyle("é ✅ #", "bold")).toBe("é ✅ #");
  });

  it("re-styles instead of stacking, and clears back to plain text", () => {
    const bold = applyUnicodeStyle("Plan 9", "bold");
    expect(applyUnicodeStyle(bold, "italic")).toBe(applyUnicodeStyle("Plan 9", "italic"));
    expect(clearUnicodeStyles(applyUnicodeStyle(bold, "boldItalic"))).toBe("Plan 9");
    expect(clearUnicodeStyles(bold)).toBe("Plan 9");
  });

  it("turns lines into lists, replacing existing markers and skipping blank lines", () => {
    expect(formatAsList("one\n\n• two\n3) three", "number")).toBe("1. one\n\n2. two\n3. three");
    expect(formatAsList("1. a\n- b", "arrow")).toBe("→ a\n→ b");
  });

  it("tidies spacing", () => {
    expect(tidySpacing("a  \r\n\r\n\r\n\nb\t\n")).toBe("a\n\nb");
  });

  it("counts characters as code points and finds the see-more cut", () => {
    const stats = postStats("𝗛𝗶 ✅ #Growth #AI\nline 2\nline 3\nline 4");
    expect(stats.characters).toBe([..."𝗛𝗶 ✅ #Growth #AI\nline 2\nline 3\nline 4"].length);
    expect(stats.hashtags).toBe(2);
    expect(stats.preview).toBe("𝗛𝗶 ✅ #Growth #AI\nline 2\nline 3");
    expect(stats.truncated).toBe(true);
    expect(stats.remaining).toBe(LINKEDIN_POST_MAX_CHARACTERS - stats.characters);
  });

  it("cuts long opening paragraphs at a word boundary", () => {
    const stats = postStats("word ".repeat(80));
    expect([...stats.preview].length).toBeLessThanOrEqual(210);
    expect(stats.preview.endsWith("word")).toBe(true);
    expect(stats.truncated).toBe(true);
    expect(postStats("Short post").truncated).toBe(false);
    expect(postStats("").words).toBe(0);
  });
});
