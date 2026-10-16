/**
 * Self-repetition detection: lexical similarity between a candidate draft and
 * the author's own past posts, for an honest "you posted something very
 * similar before" warning. Deliberately NOT a general plagiarism/copyright
 * check (nothing here compares against external sources) and NOT semantic
 * (no embeddings/AI call) — a bounded, deterministic, explainable signal only.
 */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "is", "are", "was", "were",
  "it", "this", "that", "be", "as", "at", "by", "from", "has", "have", "had", "i", "we", "you", "our", "your",
]);

/** Unicode-preserving, same family as universalFeedParser's title normalizer. */
function tokenize(text: string): string[] {
  return text
    .normalize("NFKC").toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(token => token.length > 1 && !STOPWORDS.has(token));
}

/** Overlapping word-shingles; order-sensitive, so paraphrases score lower than near-verbatim reuse. */
function shingles(tokens: string[], size: number): Set<string> {
  if (tokens.length < size) return tokens.length ? new Set([tokens.join(" ")]) : new Set();
  const set = new Set<string>();
  for (let i = 0; i <= tokens.length - size; i++) set.add(tokens.slice(i, i + size).join(" "));
  return set;
}

/**
 * Jaccard similarity of 5-word shingles, in [0, 1]. 0 when either text has no
 * usable tokens (never divide by zero, never claim false similarity).
 */
export function selfRepetitionScore(a: string, b: string, shingleSize = 5): number {
  const shinglesA = shingles(tokenize(a), shingleSize);
  const shinglesB = shingles(tokenize(b), shingleSize);
  if (shinglesA.size === 0 || shinglesB.size === 0) return 0;
  let intersection = 0;
  for (const shingle of shinglesA) if (shinglesB.has(shingle)) intersection++;
  return intersection / (shinglesA.size + shinglesB.size - intersection);
}

export interface RepetitionCandidate { id: string; content: string; platform: string; publishedAt: Date | string | null; updatedAt: Date | string | null }
export interface RepetitionMatch { id: string; platform: string; publishedAt: Date | string | null; updatedAt: Date | string | null; score: number }

/** Threshold chosen so near-verbatim reposts flag but topically-related, differently-worded posts don't. */
export const SELF_REPETITION_THRESHOLD = 0.45;

/** Best matches above the threshold, most similar first, capped to a short list. */
export function findSelfRepetitionMatches(content: string, candidates: RepetitionCandidate[], excludeId?: string, limit = 3): RepetitionMatch[] {
  return candidates
    .filter(candidate => candidate.id !== excludeId)
    .map(candidate => ({ id: candidate.id, platform: candidate.platform, publishedAt: candidate.publishedAt, updatedAt: candidate.updatedAt, score: selfRepetitionScore(content, candidate.content) }))
    .filter(match => match.score >= SELF_REPETITION_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
