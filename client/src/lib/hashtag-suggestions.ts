// Platform hashtag conventions mirrored from server/services/punditBrain.ts's
// PLATFORM_LIMITS.maxHashtags (presentation-only suggestions, not enforced).
const PLATFORM_HASHTAG_CAPS: Record<string, number> = {
  linkedin: 5, twitter: 2, threads: 2, bluesky: 1, substack: 0, medium: 0, reddit: 0, mastodon: 3,
  devto: 0, hashnode: 0, quora: 0, facebook: 2, telegram: 3, discord: 0, farcaster: 1, xiaohongshu: 5,
  weibo: 3, wechat: 0, maimai: 2, vk: 3, line: 0, naver: 5, xing: 3,
};

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "is", "are", "was", "were",
  "be", "been", "this", "that", "these", "those", "it", "its", "as", "at", "by", "from", "into", "about",
  "than", "then", "so", "not", "no", "yes", "we", "you", "your", "our", "their", "his", "her", "they",
  "he", "she", "will", "can", "could", "should", "would", "has", "have", "had", "do", "does", "did",
  "if", "because", "while", "when", "where", "what", "who", "whom", "which", "there", "here", "just",
  "more", "most", "some", "any", "all", "over", "after", "before", "up", "down", "out", "off", "per", "via",
]);

function toHashtag(phrase: string): string {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return (words[0] ?? "").replace(/[^A-Za-z0-9]/g, "");
  return words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join("").replace(/[^A-Za-z0-9]/g, "");
}

/**
 * Suggests hashtags derived ONLY from this generated post's own text — real
 * (repeated/capitalized terms already in the content), not fabricated or
 * claimed to be "trending". Purely a presentational suggestion the user can
 * click to append; nothing is inserted automatically.
 */
export function suggestHashtags(content: string, platformKey: string): string[] {
  const cap = PLATFORM_HASHTAG_CAPS[platformKey] ?? 2;
  if (cap <= 0 || !content.trim()) return [];
  const existing = new Set((content.match(/#\w+/g) ?? []).map(tag => tag.slice(1).toLowerCase()));
  const withoutUrls = content.replace(/https?:\/\/\S+/g, " ");

  const candidates: Array<{ key: string; display: string; score: number }> = [];
  const seen = new Set<string>();

  // Capitalized multi-word phrases (likely proper nouns/named entities), e.g. "Open Source".
  const phraseCounts = new Map<string, number>();
  const phraseMatches = withoutUrls.match(/\b[A-Z][a-zA-Z0-9]*(?:\s+[A-Z][a-zA-Z0-9]*){0,2}\b/g) ?? [];
  for (const phrase of phraseMatches) phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
  for (const phrase of phraseMatches) {
    if (phrase.split(/\s+/).some(word => word.length < 2)) continue;
    const key = phrase.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key || seen.has(key) || existing.has(key)) continue;
    seen.add(key);
    candidates.push({ key, display: toHashtag(phrase), score: (phraseCounts.get(phrase) ?? 1) * 2 });
  }

  // Frequent significant single words, as a fallback supplement.
  const wordCounts = new Map<string, number>();
  for (const word of withoutUrls.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
    if (!STOPWORDS.has(word)) wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
  }
  for (const [word, score] of wordCounts) {
    if (seen.has(word) || existing.has(word) || score < 2) continue;
    seen.add(word);
    candidates.push({ key: word, display: toHashtag(word), score });
  }

  return candidates.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key)).slice(0, cap).map(candidate => `#${candidate.display}`);
}
