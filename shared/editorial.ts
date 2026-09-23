/** Compact article structure; existing generation and publishing limits still apply. */
export const ARTICLE_PLATFORMS = ["linkedin", "medium", "reddit", "devto", "hashnode", "quora", "wechat", "naver"] as const;
export type EditorialFormat = "short-post" | "article";
/** Writer tone keys; a request may ask for any subset. */
export const EDITORIAL_TONES = ["thoughtLeader", "industryInsider", "provocateur", "dataDriven"] as const;
export type EditorialTone = typeof EDITORIAL_TONES[number];
/** X shortens every link to a 23-character t.co URL, so that is what counts toward 280. */
export const X_LINK_LENGTH = 23;
export function platformTextLength(content: string, platform: string): number {
  return platform === "twitter" ? content.replace(/https?:\/\/\S+/g, "x".repeat(X_LINK_LENGTH)).length : content.length;
}
export function supportsArticle(platform: string): boolean {
  return (ARTICLE_PLATFORMS as readonly string[]).includes(platform);
}