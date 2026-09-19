import { createHash } from "node:crypto";
import type { ArticleInputKind, SummaryProvenance } from "@shared/article-quality";

/** Complete contiguous opening sentences, not stitched keyword passages or generated claims. */
export function summarizeArticle(input: string, inputKind: ArticleInputKind = "feed_excerpt") {
  const text = input.slice(0, 100_000);
  const provenance: SummaryProvenance = { version: "contiguous-v1", method: "unavailable", inputKind,
    inputHash: createHash("sha256").update(text).digest("hex"), inputLength: text.length, spans: [], warnings: [] };
  if (input.length > text.length) provenance.warnings.push("input_bounded");
  if (inputKind !== "page_body") provenance.warnings.push("excerpt_only");
  const segments = new Intl.Segmenter("en", { granularity: "sentence" }).segment(text);
  let start = -1; let end = 0; let sentences = 0;
  for (const segment of segments) {
    const sentence = segment.segment.trim();
    if (!sentence) continue;
    // Never cut a sentence or skip context to cherry-pick a later claim.
    if (!/[.!?。！？]["'”’»）)]*$/.test(sentence) || /(?:\.\.\.|…)[\s.!?。！？"'”’»）)]*$/.test(sentence)) break;
    if (start < 0) start = segment.index + segment.segment.indexOf(sentence);
    const nextEnd = segment.index + segment.segment.trimEnd().length;
    if (nextEnd - start > 700 || sentences >= 3) break;
    end = nextEnd; sentences++;
  }
  if (start < 0 || end - start < 60 || text.slice(start, end).split(/\s+/u).length < 8) {
    provenance.warnings.push("insufficient_complete_text");
    return { summary: null, provenance };
  }
  provenance.method = inputKind === "page_body" ? "extractive" : "source_excerpt";
  provenance.spans = [{ start, end }];
  return { summary: text.slice(start, end), provenance };
}