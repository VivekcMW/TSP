import { createHash } from "node:crypto";

export const MAX_SOURCE_CHARACTERS = 24_000;
const MAX_PASSAGE_CHARACTERS = 1200;
const MAX_PASSAGES = 128;

export type SourceWarningCode = "source_truncated" | "metadata_only" | "limited_source_content" | "extraction_unknown" | "passage_limit";
export interface SourceWarning { code: SourceWarningCode; message: string }
export interface SourceContentMetadata {
  extractionMethod: "article" | "main" | "paragraph_cluster" | "metadata" | "manual";
  originalLength: number;
  retainedLength: number;
  truncated: boolean;
}
export interface SourceExcerpt {
  id: string;
  text: string;
  /** UTF-16 offsets into the supplied content, end-exclusive. Not HTML offsets. */
  start: number;
  end: number;
}
export interface EvidenceBrief {
  sourceId: string;
  title: string;
  source: string;
  url?: string;
  sourceBrief: string;
  excerpts: SourceExcerpt[];
  warnings: SourceWarning[];
  contentMetadata?: SourceContentMetadata;
  suppliedCharacters: number;
  retainedCharacters: number;
  /** Exact source-text matching is not independent factual verification. */
  verification: "source-excerpts-only";
}
export interface EvidenceAttribution {
  /** Exact span of the generated content that the writer attributes to passages. */
  text: string;
  excerptIds: string[];
}

interface EvidenceInput {
  title: string; content: string; source: string; url?: string; contentMetadata?: SourceContentMetadata;
}

function appendParagraph(retained: string, start: number, paragraphEnd: number, excerpts: SourceExcerpt[]) {
  while (start < paragraphEnd && excerpts.length < MAX_PASSAGES) {
    while (start < paragraphEnd && /\s/.test(retained[start])) start++;
    if (start >= paragraphEnd) break;
    let end = Math.min(start + MAX_PASSAGE_CHARACTERS, paragraphEnd);
    if (end < paragraphEnd) {
      const space = retained.lastIndexOf(" ", end);
      if (space > start + MAX_PASSAGE_CHARACTERS / 2) end = space;
    }
    const text = retained.slice(start, end).trimEnd();
    excerpts.push({ id: `p${excerpts.length + 1}`, text, start, end: start + text.length });
    start = end;
  }
}

function sourceWarnings(input: EvidenceInput, retained: string, excerpts: SourceExcerpt[]): SourceWarning[] {
  const warnings: SourceWarning[] = [];
  if (input.content.length > retained.length || input.contentMetadata?.truncated) {
    warnings.push({ code: "source_truncated", message: "Source content was truncated; omitted context may change the interpretation." });
  }
  if (input.contentMetadata?.extractionMethod === "metadata") {
    warnings.push({ code: "metadata_only", message: "Only a page description was extracted, not the article body. Review against the original before publishing." });
  }
  if (retained.trim().length < 200) {
    warnings.push({ code: "limited_source_content", message: "Very little source text is available. This is a length warning, not an assessment of factual quality." });
  }
  if (!input.contentMetadata) {
    warnings.push({ code: "extraction_unknown", message: "Extraction provenance is unavailable; this may be a summary rather than the full article." });
  }
  if (excerpts.length === MAX_PASSAGES && retained.slice(excerpts.at(-1)!.end).trim()) {
    warnings.push({ code: "passage_limit", message: "The passage limit was reached; later source passages were omitted." });
  }
  return warnings;
}

/** Deterministic, ordered passages, not an LLM summary or a keyword truth score. */
export function buildEvidenceBrief(input: EvidenceInput): EvidenceBrief {
  const retained = input.content.slice(0, MAX_SOURCE_CHARACTERS);
  const excerpts: SourceExcerpt[] = [];
  // Retain paragraph boundaries; split huge paragraphs at whitespace when possible.
  for (const paragraph of retained.matchAll(/[^\r\n]+/g)) {
    appendParagraph(retained, paragraph.index!, paragraph.index! + paragraph[0].length, excerpts);
    if (excerpts.length >= MAX_PASSAGES) break;
  }
  return {
    sourceId: createHash("sha256").update(JSON.stringify([input.title, input.source, input.url ?? "", input.content])).digest("hex"),
    title: input.title, source: input.source, url: input.url,
    sourceBrief: excerpts.map(excerpt => `[${excerpt.id}] ${excerpt.text}`).join("\n\n"),
    excerpts, warnings: sourceWarnings(input, retained, excerpts), contentMetadata: input.contentMetadata,
    suppliedCharacters: input.content.length,
    retainedCharacters: excerpts.reduce((sum, excerpt) => sum + excerpt.text.length, 0),
    verification: "source-excerpts-only",
  };
}

/** Verifies the mapping literally. Does NOT establish that an attributed claim is true. */
export function verifySourceExcerpt(content: string, excerpt: SourceExcerpt): boolean {
  return Number.isInteger(excerpt.start) && Number.isInteger(excerpt.end) && excerpt.start >= 0 &&
    excerpt.end > excerpt.start && excerpt.end <= content.length &&
    content.slice(excerpt.start, excerpt.end) === excerpt.text;
}

export function validateEvidenceAttributions(content: string, attributions: EvidenceAttribution[], brief: EvidenceBrief): string[] {
  const errors: string[] = [];
  const ids = new Set(brief.excerpts.map(excerpt => excerpt.id));
  if (!attributions.length) errors.push("Provide at least one source attribution for a reported point");
  for (const attribution of attributions) {
    if (!content.includes(attribution.text)) errors.push("Attribution text must be an exact span of the generated content");
    if (!attribution.excerptIds.length || attribution.excerptIds.some(id => !ids.has(id))) {
      errors.push("Attributions must refer only to supplied excerpt IDs");
    }
  }
  return [...new Set([...errors, ...validateQuotations(content, attributions, brief)])];
}

function validateQuotations(content: string, attributions: EvidenceAttribution[], brief: EvidenceBrief): string[] {
  const errors: string[] = [];
  // Conservative quotation check. Speaker identity/meaning still requires human review.
  const quotes = /"([^"\n]{1,1200})"|“([^”\n]{1,1200})”|‘([^’\n]{1,1200})’|(?:^|\s)'([^'\n]{1,1200})'/g;
  for (const quote of content.matchAll(quotes)) {
    const text = quote[1] ?? quote[2] ?? quote[3] ?? quote[4];
    const cited = new Set(attributions.filter(attribution => attribution.text.includes(text)).flatMap(attribution => attribution.excerptIds));
    if (!brief.excerpts.some(excerpt => cited.has(excerpt.id) && excerpt.text.includes(text))) {
      errors.push("Quoted text must appear verbatim in a cited passage");
    }
  }
  // A narrow safety guard, not an exhaustive personal-claim or factual verifier.
  const unquoted = content.replace(quotes, " ");
  const personalAccess = /\b(?:I|we)\s+(?:personally\s+)?(?:spoke|met|interviewed|built|tested|saw|witnessed|worked|led)\b/i;
  const personalExperience = /\b(?:my|our)\s+(?:clients?|customers?|team|experience)\b/i;
  if (personalAccess.test(unquoted) || personalExperience.test(unquoted)) {
    errors.push("Do not claim personal experience or access; attribute source experiences to the source");
  }
  return errors;
}