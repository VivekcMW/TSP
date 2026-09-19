/** Deliberately conservative source-support triage, NOT a fact/entailment verifier. */
export type ClaimSupport = "supported" | "unsupported" | "contradictory" | "unknown";
export interface ClaimSpan { excerptId: string; text: string; start: number; end: number }
export interface ClaimCheck {
  text: string;
  start: number;
  end: number;
  status: ClaimSupport;
  reason: "exact-source-sentence" | "number-conflict" | "negation-conflict" | "entity-mismatch" | "missing-citation" | "unknown-citation" | "meaning-not-established";
  sourceSpans: ClaimSpan[];
}
export interface ClaimSupportReport {
  method: "conservative-source-comparison-v1";
  status: "needs-review";
  factualVerification: "not-performed";
  requiresHumanReview: true;
  truncated: boolean;
  claims: ClaimCheck[];
}
interface Excerpt { id: string; text: string; start: number; end: number }
interface Attribution { text: string; excerptIds: string[] }
export const MAX_CLAIM_REPORT_BYTES = 12_000;

// Preserve UTF-16 offsets, decimals, and full sentence context (not arbitrary substrings).
function sentences(text: string) {
  const result: Array<{ text: string; start: number; end: number }> = [];
  const boundary = /[^\n]+/g;
  for (const line of text.matchAll(boundary)) {
    let cursor = line.index!;
    for (const part of line[0].split(/(?<=[.!?])\s+(?=[\p{Lu}\d])/u)) {
      const start = text.indexOf(part, cursor);
      const leading = part.length - part.trimStart().length;
      const value = part.trim();
      if (value) result.push({ text: value, start: start + leading, end: start + leading + value.length });
      cursor = start + part.length;
    }
  }
  return result;
}
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const numbers = /[+-]?\d+(?:[.,]\d+)*(?:\s?(?:%|percent|million|billion|thousand))?/gi;
const negation = /\b(?:not|never|no|without|cannot)\b|\b\w+n['’]t\b/gi;
const skeleton = (text: string, pattern: RegExp) => normalize(text.replace(pattern, " ")).toLowerCase();
const entities = (text: string) => text.match(/\b[A-Z][A-Za-z\d]*(?:\s+[A-Z][A-Za-z\d]*)*/g) ?? [];

export function checkClaimSupport(content: string, attributions: readonly Attribution[], excerpts: readonly Excerpt[]): ClaimSupportReport {
  const bounded = content.slice(0, 5000);
  const candidates = sentences(bounded).filter(span => !/^https?:\/\/\S+$/.test(span.text));
  // Never fabricate offsets or turn a cutoff fragment into a supported sentence.
  const validExcerpts = excerpts.slice(0, 128).filter(excerpt => Number.isSafeInteger(excerpt.start) && excerpt.start >= 0 &&
    excerpt.end === excerpt.start + excerpt.text.length && excerpt.text.length <= 1200);
  let truncated = content.length > bounded.length || candidates.length > 64 || validExcerpts.length !== excerpts.length ||
    attributions.length > 32 || attributions.some(attribution => attribution.excerptIds.length > 128);
  const source = validExcerpts.flatMap(excerpt => sentences(excerpt.text).map(span => ({
    excerptId: excerpt.id, text: span.text, start: excerpt.start + span.start, end: excerpt.start + span.end,
  })));
  const claims = candidates.slice(0, 64).map((claim): ClaimCheck => {
    // Use only writer-selected citations covering this specific occurrence.
    const ids = new Set(attributions.slice(0, 32).filter(attribution => {
      if (!attribution.text.trim()) return false;
      let offset = bounded.indexOf(attribution.text);
      while (offset >= 0) {
        if (offset <= claim.start && offset + attribution.text.length >= claim.end) return true;
        offset = bounded.indexOf(attribution.text, offset + 1);
      }
      return false;
    }).flatMap(attribution => attribution.excerptIds.slice(0, 128)));
    const cited = source.filter(span => ids.has(span.excerptId));
    if (cited.length > 8) truncated = true;
    const base = { ...claim, sourceSpans: cited.slice(0, 8) };
    if (!ids.size) return { ...base, status: "unsupported", reason: "missing-citation" };
    if ([...ids].some(id => !excerpts.some(excerpt => excerpt.id === id))) return { ...base, status: "unknown", reason: "unknown-citation" };
    // Only whole, case-sensitive sentence equality earns textual support. Lexical
    // similarity, overlapping keywords, or a valid p ID never earn this label.
    const exact = cited.find(span => normalize(span.text) === normalize(claim.text));
    const numberConflict = (text: string) => JSON.stringify(text.toLowerCase().match(numbers) ?? []) !== JSON.stringify(claim.text.toLowerCase().match(numbers) ?? []) &&
      skeleton(text, numbers) === skeleton(claim.text, numbers);
    const conflict = cited.find(span => numberConflict(span.text) ||
      (Boolean(span.text.match(negation)) !== Boolean(claim.text.match(negation)) && skeleton(span.text, negation) === skeleton(claim.text, negation)));
    if (conflict) return { ...base, sourceSpans: [conflict, ...(exact ? [exact] : [])], status: "contradictory",
      reason: numberConflict(conflict.text) ? "number-conflict" : "negation-conflict" };
    if (exact) return { ...base, sourceSpans: [exact], status: "supported", reason: "exact-source-sentence" };
    const names = entities(claim.text);
    const entityMismatch = cited.some(span => {
      const sourceNames = entities(span.text);
      return names.length > 0 && sourceNames.length > 0 && names.join("|") !== sourceNames.join("|") &&
        normalize(claim.text.replace(/\b[A-Z][A-Za-z\d]*(?:\s+[A-Z][A-Za-z\d]*)*/g, "ENTITY")) ===
        normalize(span.text.replace(/\b[A-Z][A-Za-z\d]*(?:\s+[A-Z][A-Za-z\d]*)*/g, "ENTITY"));
    });
    return { ...base, status: entityMismatch ? "unsupported" : "unknown", reason: entityMismatch ? "entity-mismatch" : "meaning-not-established" };
  });
  // Bound the serialized diagnostic overhead, including multi-byte text. Keep
  // complete claims/spans only; the unchanged evidence panel holds the source.
  const encoder = new TextEncoder();
  let bytes = 512; // Reserve report envelope + array separators.
  const boundedClaims: ClaimCheck[] = [];
  for (const claim of claims) {
    bytes += encoder.encode(JSON.stringify(claim)).byteLength + 1;
    if (bytes > MAX_CLAIM_REPORT_BYTES) { truncated = true; break; }
    boundedClaims.push(claim);
  }
  return { method: "conservative-source-comparison-v1", status: "needs-review", factualVerification: "not-performed", requiresHumanReview: true,
    truncated, claims: boundedClaims };
}