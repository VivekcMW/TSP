import { describe, expect, it } from "vitest";
import { checkClaimSupport, MAX_CLAIM_REPORT_BYTES } from "./editorial-claims";
const source = "Acme revenue is 12.5 million.\n\nAcme is not profitable.";
const excerpts = source.split("\n\n").map((text, index) => ({ id: `p${index + 1}`, text, start: source.indexOf(text), end: source.indexOf(text) + text.length }));
const report = (text: string, ids = ["p1", "p2"]) => checkClaimSupport(text, [{ text, excerptIds: ids }], excerpts);
describe("honest source support, never factual verification", () => {
  it("supports exact source sentences and returns real source spans", () => {
    const text = excerpts[0].text;
    const result = report(text, ["p1"]);
    expect(result.claims[0]).toMatchObject({ status: "supported", reason: "exact-source-sentence", start: 0, end: text.length });
    for (const span of result.claims[0].sourceSpans) expect(source.slice(span.start, span.end)).toBe(span.text);
    expect(result).toMatchObject({ status: "needs-review", factualVerification: "not-performed", requiresHumanReview: true });
  });
  it.each([
    ["Acme revenue is 18.5 million.", "contradictory", "number-conflict"],
    ["Acme revenue is 12.5 billion.", "contradictory", "number-conflict"],
    ["Acme revenue is -12.5 million.", "contradictory", "number-conflict"],
    ["Acme is profitable.", "contradictory", "negation-conflict"],
    ["Beta revenue is 12.5 million.", "unsupported", "entity-mismatch"],
    ["Acme earned strong revenue.", "unknown", "meaning-not-established"],
    ["Acme revenue is booming with record profits.", "unknown", "meaning-not-established"],
    ["ACME REVENUE IS 12.5 MILLION.", "unknown", "meaning-not-established"],
  ])("triages %s without inventing entailment", (text, status, reason) => {
    expect(report(text).claims[0]).toMatchObject({ status, reason });
    expect(report(text).factualVerification).toBe("not-performed");
  });
  it("cannot upgrade a sentence from non-cited passages or invent IDs", () => {
    expect(report(excerpts[1].text, ["p1"]).claims[0].status).toBe("unknown");
    expect(report(excerpts[0].text, ["p99"]).claims[0]).toMatchObject({ status: "unknown", reason: "unknown-citation", sourceSpans: [] });
    expect(report(excerpts[0].text, ["p1", "p99"]).claims[0].status).toBe("unknown");
  });
  it("reports uncited output instead of trusting only mapped segments", () => {
    const result = checkClaimSupport(excerpts[0].text + "\n\nRevenue doubled worldwide.", [{ text: excerpts[0].text, excerptIds: ["p1"] }], excerpts);
    expect(result.claims.map(claim => claim.status)).toEqual(["supported", "unsupported"]);
    expect(result.claims[1].reason).toBe("missing-citation");
  });
  it("never supports a substring with omitted negation, speaker or uncertainty", () => {
    for (const text of ["profitable.", "revenue is 12.5 million.", "Acme revenue is 12.5 million. Everyone gained."]) {
      expect(report(text).claims.some(claim => claim.status !== "supported")).toBe(true);
    }
    const text = "Acme is profitable.";
    const context = "The claim that Acme is profitable. is false.";
    expect(checkClaimSupport(text, [{ text, excerptIds: ["p1"] }], [{ id: "p1", text: context, start: 0, end: context.length }]).claims[0].status).not.toBe("supported");
  });
  it("flags conflicting cited sentences even when one is exact", () => {
    const text = "Acme is profitable.";
    const negative = "Acme is not profitable.";
    const result = checkClaimSupport(text, [{ text, excerptIds: ["p1", "p2"] }], [{ id: "p1", text, start: 0, end: text.length }, { id: "p2", text: negative, start: 30, end: 30 + negative.length }]);
    expect(result.claims[0].status).toBe("contradictory");
  });
  it("bounds work and reports truncation honestly", () => {
    expect(checkClaimSupport("A claim.\n".repeat(100), [], []).claims).toHaveLength(64);
    const withComparisons = report("A claim.\n".repeat(100));
    expect(withComparisons.claims.length).toBeLessThanOrEqual(64);
    expect(withComparisons.truncated).toBe(true);
    expect(report("x".repeat(5001)).truncated).toBe(true);
    expect(report("https://news.test/source").claims).toEqual([]);
  });
  it("ignores empty attributions without an unbounded occurrence scan", () => {
    const result = checkClaimSupport(source, [{ text: "", excerptIds: ["p1"] }], excerpts);
    expect(result.claims.every(claim => claim.reason === "missing-citation")).toBe(true);
  });
  it("does not use malformed offsets or an oversized cutoff excerpt as support", () => {
    const text = excerpts[0].text;
    for (const invalid of [{ ...excerpts[0], start: -1 }, { ...excerpts[0], end: 999 }, { ...excerpts[0], text: text + "x".repeat(1200), end: text.length + 1200 }]) {
      const result = checkClaimSupport(text, [{ text, excerptIds: ["p1"] }], [invalid]);
      expect(result.claims[0]).toMatchObject({ status: "unknown", sourceSpans: [] });
      expect(result.truncated).toBe(true);
    }
  });
  it("keeps complete UTF-16 source spans including non-BMP characters", () => {
    const text = "Acme posted 🚀 growth.";
    const full = `Introduction.\n\n${text}`;
    const start = full.indexOf(text);
    const result = checkClaimSupport(text, [{ text, excerptIds: ["p1"] }], [{ id: "p1", text, start, end: full.length }]);
    expect(result.claims[0].status).toBe("supported");
    for (const span of result.claims[0].sourceSpans) expect(full.slice(span.start, span.end)).toBe(span.text);
  });
  it("bounds report bytes even for many repeated multi-byte comparison spans", () => {
    const text = "Another unsupported conclusion.\n".repeat(64);
    const comparison = "量".repeat(1100) + ".";
    const large = Array.from({ length: 8 }, (_, index) => ({ id: `p${index}`, text: comparison, start: index * 1200, end: index * 1200 + comparison.length }));
    const result = checkClaimSupport(text, [{ text, excerptIds: large.map(excerpt => excerpt.id) }], large);
    expect(result.truncated).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(MAX_CLAIM_REPORT_BYTES);
    expect(result).toMatchObject({ status: "needs-review", factualVerification: "not-performed", requiresHumanReview: true });
  });
});