/** Compact article structure; existing generation and publishing limits still apply. */
export const ARTICLE_PLATFORMS = ["linkedin", "medium", "reddit", "devto", "hashnode", "quora", "wechat", "naver"] as const;
export type EditorialFormat = "short-post" | "article";
/** Writer tone keys; a request may ask for any subset. */
export const EDITORIAL_TONES = ["thoughtLeader", "industryInsider", "provocateur", "dataDriven"] as const;
export type EditorialTone = typeof EDITORIAL_TONES[number];
/** Persistence/application cap in raw UTF-16 code units, NOT a platform count. */
export const MAX_DRAFT_CHARACTERS = 5000;
/** X shortens every link to a 23-character t.co URL, so that is what counts toward 280. */
export const X_LINK_LENGTH = 23;
// A sentence can end right after a link; platforms do not treat that punctuation as part of it.
const TRAILING_LINK_PUNCTUATION = /[.,;:!?)\]}"'\u201D\u2019\u00BB]+$/u;
export function trimLinkPunctuation(url: string): string {
  return url.replace(TRAILING_LINK_PUNCTUATION, "");
}
/** Application counting contract: UTF-16 code units, with HTTP(S) links weighted
 * to 23 on X. No trimming, Unicode normalization or grapheme conversion. This
 * retains the existing Create rule; it is not a complete provider text parser. */
export function platformTextLength(content: string, platform: string): number {
  if (platform !== "twitter") return content.length;
  return content.replace(/https?:\/\/\S+/g, link => "x".repeat(X_LINK_LENGTH) + link.slice(trimLinkPunctuation(link).length)).length;
}
/** Platform and per-user bounds use the SAME count; raw storage is independent. */
export function platformTextValidation(content: string, platform: string, maxCharacters: number, minCharacters = 1) {
  const length = platformTextLength(content, platform);
  const rawLength = content.length;
  let error: string | null = null;
  if (!content.trim()) error = "Enter nonblank content.";
  else if (rawLength > MAX_DRAFT_CHARACTERS) error = `Application storage limit exceeded: ${rawLength}/${MAX_DRAFT_CHARACTERS} raw characters (UTF-16), regardless of platform link weighting.`;
  else if (length > maxCharacters) error = `Too long: ${length}/${maxCharacters} platform characters.`;
  else if (length < minCharacters) error = `Needs at least ${minCharacters} platform characters (currently ${length}).`;
  return { length, rawLength, maxCharacters, error };
}
export function supportsArticle(platform: string): boolean {
  return (ARTICLE_PLATFORMS as readonly string[]).includes(platform);
}