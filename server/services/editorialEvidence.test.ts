import { describe, expect, it } from "vitest";
import { buildEvidenceBrief, MAX_SOURCE_CHARACTERS, validateEvidenceAttributions, verifySourceExcerpt } from "./editorialEvidence";

const source = { title: "Trial", source: "Research Desk", content: "  A pilot reported a 12% reduction.\n\nThe trial covered 30 stores, with no control group.  " };

describe("deterministic editorial evidence", () => {
  it("retains exact paragraphs and original offsets without making up a summary", () => {
    const brief = buildEvidenceBrief(source);
    expect(brief).toEqual(buildEvidenceBrief(source));
    expect(brief.excerpts).toEqual([
      { id: "p1", text: "A pilot reported a 12% reduction.", start: 2, end: 35 },
      { id: "p2", text: "The trial covered 30 stores, with no control group.", start: 37, end: 88 },
    ]);
    expect(brief.excerpts.every(excerpt => verifySourceExcerpt(source.content, excerpt))).toBe(true);
    expect(brief.sourceBrief).toContain("no control group");
    expect(brief.verification).toBe("source-excerpts-only");
    expect(buildEvidenceBrief({ ...source, content: source.content + "Changed" }).sourceId).not.toBe(brief.sourceId);
  });

  it("rejects forged text, out-of-bounds, and fractional excerpt mappings", () => {
    const excerpt = buildEvidenceBrief(source).excerpts[0];
    expect(verifySourceExcerpt(source.content, { ...excerpt, text: "invented" })).toBe(false);
    expect(verifySourceExcerpt(source.content, { ...excerpt, start: -1 })).toBe(false);
    expect(verifySourceExcerpt(source.content, { ...excerpt, end: 9999 })).toBe(false);
    expect(verifySourceExcerpt(source.content, { ...excerpt, start: 1.5 })).toBe(false);
  });

  it("bounds long sources without silently dropping the warning", () => {
    const content = "A long paragraph with source evidence. ".repeat(1000);
    const brief = buildEvidenceBrief({ ...source, content });
    expect(brief.retainedCharacters).toBeLessThanOrEqual(MAX_SOURCE_CHARACTERS);
    expect(brief.excerpts.every(excerpt => excerpt.end <= MAX_SOURCE_CHARACTERS && verifySourceExcerpt(content, excerpt))).toBe(true);
    expect(brief.warnings.map(warning => warning.code)).toContain("source_truncated");
  });

  it("warns about metadata-only content, known upstream truncation, and unknown provenance", () => {
    const brief = buildEvidenceBrief({ ...source, contentMetadata: {
      extractionMethod: "metadata", originalLength: 1000, retainedLength: source.content.length, truncated: true,
    } });
    expect(brief.warnings.map(warning => warning.code)).toEqual(["source_truncated", "metadata_only", "limited_source_content"]);
    expect(buildEvidenceBrief(source).warnings.map(warning => warning.code)).toContain("extraction_unknown");
  });

  it("bounds large numbers of paragraphs and keeps the omission visible", () => {
    const brief = buildEvidenceBrief({ ...source, content: Array.from({ length: 150 }, (_, index) => `Paragraph ${index}`).join("\n") });
    expect(brief.excerpts).toHaveLength(128);
    expect(brief.warnings.map(warning => warning.code)).toContain("passage_limit");
  });

  it("checks attribution references and exact output spans, not keyword-based truth", () => {
    const brief = buildEvidenceBrief(source);
    expect(validateEvidenceAttributions("A reported pilot.", [{ text: "A reported pilot.", excerptIds: ["p1"] }], brief)).toEqual([]);
    expect(validateEvidenceAttributions("A reported pilot.", [{ text: "not in output", excerptIds: ["p99"] }], brief)).toHaveLength(2);
    expect(validateEvidenceAttributions("A reported pilot.", [], brief)).not.toEqual([]);
    // A semantic contradiction cannot be proved/disproved by this structural validator.
    expect(validateEvidenceAttributions("The trial had a control group.", [{ text: "The trial had a control group.", excerptIds: ["p2"] }], brief)).toEqual([]);
  });

  it("rejects invented quotations and obvious personal-access claims", () => {
    const brief = buildEvidenceBrief(source);
    const validate = (content: string) => validateEvidenceAttributions(content, [{ text: content, excerptIds: ["p1"] }], brief);
    expect(validate('The source said "a guaranteed success".')).toContain("Quoted text must appear verbatim in a cited passage");
    expect(validate('The source says "A pilot reported a 12% reduction.".')).toEqual([]);
    expect(validate("I personally interviewed the team.")).not.toEqual([]);
  });

  it("requires quotes to match the cited passage, not an unrelated passage", () => {
    const brief = buildEvidenceBrief(source);
    const content = 'The report says "no control group".';
    expect(validateEvidenceAttributions(content, [{ text: content, excerptIds: ["p1"] }], brief)).not.toEqual([]);
    expect(validateEvidenceAttributions(content, [{ text: content, excerptIds: ["p2"] }], brief)).toEqual([]);
  });

  it("permits a verbatim attributed source experience without assigning it to the user", () => {
    const brief = buildEvidenceBrief({ ...source, content: 'The researcher said, "I tested this."' });
    const content = 'Research Desk quotes the researcher: "I tested this."';
    expect(validateEvidenceAttributions(content, [{ text: content, excerptIds: ["p1"] }], brief)).toEqual([]);
  });
});