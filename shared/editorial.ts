/** Compact article structure; existing generation and publishing limits still apply. */
export const ARTICLE_PLATFORMS = ["linkedin", "medium", "reddit", "devto", "hashnode", "quora", "wechat", "naver"] as const;
export type EditorialFormat = "short-post" | "article";
export function supportsArticle(platform: string): boolean {
  return (ARTICLE_PLATFORMS as readonly string[]).includes(platform);
}