import type { InboxItem } from "@shared/schema";

/** Presentation-only guard for obvious legacy crawl failures, not an article validator. */
export function isUsableInboxArticle(item: Readonly<Pick<InboxItem, "headline" | "summary" | "articleUrl">>): boolean {
  const title = item.headline.trim().replace(/\s+/g, " ");
  // Match access prompts, not articles such as "Login security best practices".
  if (/^(?:(?:log in|sign in|login) to\b|login(?:\s*[|–—-].*)?$)/i.test(title)) return false;

  let hostname: string;
  try {
    const url = new URL(item.articleUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return true;
    hostname = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    // Uncertain metadata is not enough evidence to hide a story.
    return true;
  }
  const titleHost = title.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/^www\./, "").replace(/\.$/, "");
  if (!hostname.includes(".") || titleHost !== hostname) return true;

  const summary = (item.summary ?? "").trim().replace(/\s+/g, " ");
  // A hostname fallback needs at least a short sentence, not a repeated title/URL.
  return summary.toLowerCase() !== title.toLowerCase() && summary !== item.articleUrl.trim()
    && summary.length >= 40 && summary.split(" ").length >= 6;
}