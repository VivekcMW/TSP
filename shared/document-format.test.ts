import { describe, expect, it } from "vitest";
import { creationSessionSchema, type CreationSession } from "./creation-session";
import { documentFromText, documentPlainText, MAX_DOCUMENT_FORMAT_LENGTH, parseDocumentFormat, type FormattedDocument } from "./document-format";

const parse = (value: unknown) => parseDocumentFormat(JSON.stringify(value));
const paragraph = (text: string): FormattedDocument => ({ type: "paragraph", content: [{ type: "text", text }] });
const state: CreationSession = {
  version: 1, step: "review", source: { mode: "manual", url: "", manual: { title: "", content: "", media: [] } },
  tone: "thoughtLeader", format: "short-post", selectedPlatforms: [], versions: [],
  main: { title: "My document", content: "Saved text", original: "", revision: 1 },
};

describe("saved document formatting", () => {
  it.each(["", "Words", "Line one\nLine two\n\nNext paragraph", "\n\nTrailing\n\n", "x".repeat(5000)])(
    "round trips plain text and paragraph boundaries (%#)", text => {
      expect(documentPlainText(parse(documentFromText(text)))).toBe(text);
    },
  );
  it("accepts supported marks, headings, alignment, quotes and lists without including markup in text", () => {
    const document: FormattedDocument = { type: "doc", content: [
      { type: "heading", attrs: { level: 2, textAlign: "center" }, content: [
        { type: "text", text: "Title", marks: [{ type: "bold" }, { type: "italic" }, { type: "underline" }, { type: "strike" }, { type: "highlight" }] },
      ] },
      { type: "blockquote", content: [paragraph("Quotation")] },
      { type: "bulletList", content: [{ type: "listItem", content: [paragraph("Bullet")] }] },
      { type: "orderedList", attrs: { start: 3, type: null }, content: [{ type: "listItem", content: [paragraph("Numbered")] }] },
      { type: "paragraph", attrs: { textAlign: "right" }, content: [{ type: "text", text: "Last" }, { type: "hardBreak" }, { type: "text", text: "line" }] },
    ] };
    expect(parse(document)).toEqual(document);
    expect(documentPlainText(document)).toBe("Title\n\nQuotation\n\nBullet\n\nNumbered\n\nLast\nline");
  });
  it.each([
    { type: "doc" },
    { type: "doc", content: [] },
    { type: "doc", content: [{ type: "text", text: "Not a block" }] },
    { type: "doc", content: [{ type: "heading", content: [{ type: "text", text: "Missing level" }] }] },
    { type: "doc", content: [{ ...paragraph("Bad alignment"), attrs: { textAlign: "justify" } }] },
    { type: "doc", content: [{ ...paragraph("Wrong attribute"), attrs: { level: 2 } }] },
    { type: "doc", content: [{ ...paragraph("Unsafe attribute"), attrs: { onclick: "bad()" } }] },
    { type: "doc", content: [{ type: "image", attrs: { src: "https://example.invalid/image" } }] },
    { type: "doc", content: [{ type: "script", text: "bad()" }] },
    { type: "doc", content: [{ type: "bulletList", content: [] }] },
    { type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "heading", attrs: { level: 1 }, content: [] }] }] }] },
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Link", marks: [{ type: "link", attrs: { href: "javascript:bad()" } }] }] }] },
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Color", marks: [{ type: "highlight", attrs: { color: "red" } }] }] }] },
  ])("rejects unsupported or invalid document structures (%#)", value => {
    expect(() => parse(value)).toThrow("Document formatting is invalid.");
  });
  it("rejects broken JSON, oversized documents, excessive depth and excessive node counts", () => {
    expect(() => parseDocumentFormat("{")).toThrow("not valid JSON");
    expect(() => parseDocumentFormat(" ".repeat(MAX_DOCUMENT_FORMAT_LENGTH + 1))).toThrow("too large");
    let deep: FormattedDocument = paragraph("Deep");
    for (let i = 0; i < 34; i++) deep = { type: "blockquote", content: [deep] };
    expect(() => parse({ type: "doc", content: [deep] })).toThrow("too complex");
    expect(() => parse({ type: "doc", content: Array.from({ length: 10_001 }, () => ({})) })).toThrow("too complex");
  });
  it("keeps old plain-text saves compatible and requires formatting to agree with saved text", () => {
    expect(creationSessionSchema.parse(state)).toEqual(state);
    const formatted = { ...state, main: { ...state.main!, formatJson: JSON.stringify(documentFromText("Saved text")) } };
    expect(creationSessionSchema.parse(formatted)).toEqual(formatted);
    expect(creationSessionSchema.safeParse({ ...formatted, main: { ...formatted.main, content: "Different" } }).success).toBe(false);
    for (const formatJson of ["", "not JSON", JSON.stringify({ type: "script" })]) {
      expect(creationSessionSchema.safeParse({ ...formatted, main: { ...formatted.main, formatJson } }).success).toBe(false);
    }
  });
});
