import { normalizeTopic, type ArticleQuality, type DiversityFeatures } from "@shared/article-quality";
import { canonicalHttpUrl } from "@shared/canonical-url";
import { createHash } from "node:crypto";

/** Origin metadata only; never a publisher display name. Google wrapper != publisher. */
export function sourceOrigin(url: string | null | undefined): string | null {
  const canonical = url && canonicalHttpUrl(url);
  if (!canonical) return null;
  const parsed = new URL(canonical);
  if (parsed.hostname === "news.google.com") return null;
  return parsed.origin;
}
export function diversityFeatures(title: string, origin: string | null, topics: string[], content?: string): DiversityFeatures {
  const titleKey = normalizeTopic(title.slice(0, 2000)).replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return { sourceOrigin: sourceOrigin(origin), titleKey,
    ...(content === undefined ? {} : { contentFingerprint: createHash("sha256").update(normalizeTopic(content.slice(0, 100_000))).digest("hex") }),
    titleTokens: [...new Set(titleKey.split(" ").filter(Boolean))].slice(0, 100),
    figures: [...title.slice(0, 2000).matchAll(/\p{N}+(?:[.,]\p{N}+)*(?:\s*[%％]|\s*(?:million|billion|trillion))?/gu)].map(m => m[0]).slice(0, 30),
    topics: [...new Set(topics.slice(0, 300).map(topic => normalizeTopic(topic)))].filter(Boolean).slice(0, 20) };
}
function sameStory(a: DiversityFeatures, b: DiversityFeatures): boolean {
  if (a.contentFingerprint !== b.contentFingerprint) return false;
  if (!a.titleKey || !b.titleKey || JSON.stringify(a.figures) !== JSON.stringify(b.figures)) return false;
  // Shared empty/boilerplate bodies do not establish equivalence. Preserve title
  // order: swapping actors/actions can reverse the claim with identical tokens.
  return a.titleKey === b.titleKey;
}
interface Candidate { articleUrl: string; relevanceScore?: string | null; rankingScore?: string | null; qualityMetadata?: ArticleQuality | null }
/** Pure features only; call AFTER canonical historical exclusion under the writer lock. */
export function selectDiverse<T extends Candidate>(candidates: readonly T[], capacity: number): T[] {
  const pool = candidates.filter(c => Number(c.relevanceScore) > 0).slice(0, 600);
  const selected: T[] = [];
  const rank = (c: T) => Number(c.rankingScore ?? c.relevanceScore) || 0;
  const inputOrder = new Map(candidates.map((c, index) => [c, index]));
  const tie = (a: T, b: T) => {
    // Legacy internal callers retain their pre-ranked tie order.
    if (!a.qualityMetadata && !b.qualityMetadata) return inputOrder.get(a)! - inputOrder.get(b)!;
    if (a.articleUrl === b.articleUrl) return 0;
    return a.articleUrl < b.articleUrl ? -1 : 1;
  };
  while (pool.length && selected.length < Math.min(10, capacity)) {
    const adjusted = (c: T) => {
      const f = c.qualityMetadata?.diversity;
      if (!f) return rank(c);
      let sourceRepeats = 0; let topicRepeats = 0;
      for (const item of selected) {
        const other = item.qualityMetadata?.diversity;
        if (!other) continue;
        if (f.sourceOrigin && f.sourceOrigin === other.sourceOrigin) sourceRepeats++;
        if (f.topics.some(t => other.topics.includes(t))) topicRepeats++;
      }
      return rank(c) / (1 + 0.2 * sourceRepeats + 0.1 * topicRepeats);
    };
    pool.sort((a, b) => adjusted(b) - adjusted(a) || rank(b) - rank(a) || tie(a, b));
    const next = pool.shift()!;
    const features = next.qualityMetadata?.diversity;
    if (features && selected.some(c => c.qualityMetadata && sameStory(features, c.qualityMetadata.diversity))) continue;
    selected.push(next);
  }
  // Diverse membership, persisted ranking order (not an interleaving promise).
  return selected.sort((a, b) => rank(b) - rank(a) || tie(a, b));
}