import { CrawlError, type CrawlPage } from "./crawlerFetch.js";

export function cleanPageHtml(html: string): string {
  return html
    .replace(/<(script|style|nav|footer|header|aside|noscript|form|button|select)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<([a-z][\w:-]*)\b[^>]*\brole\s*=\s*["'](?:navigation|menu|menubar|banner|contentinfo)["'][^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
}

export function metaContent(html: string, name: string): string | null {
  for (const tag of html.match(/<meta\b[^>]{0,2000}>/gi) ?? []) {
    const key = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (key?.toLowerCase() === name) return /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? null;
  }
  return null;
}

export function requireReadableHtml(page: CrawlPage): void {
  const type = page.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if ((type && type !== "text/html" && type !== "application/xhtml+xml") || !/<(?:html|body|article|main|p|h1)\b/i.test(page.text)) {
    throw new CrawlError("content", "This URL did not return a readable HTML page or supported feed.");
  }
  requireUngatedHtml(page.text);
}

/** Metadata or an article wrapper does not grant access to a login/challenge page. */
export function requireUngatedHtml(html: string): void {
  const headings = [...html.matchAll(/<(title|h1)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map(match => match[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
  if (headings.some(text => /just a moment|access denied|verify (?:you are|you're)|captcha|attention required/i.test(text) ||
    /^(?:sign[ -]?in|log[ -]?in|sign[ -]?up|register)(?:$|\s*(?:[|!—–-]|to (?:continue|read|access)))/i.test(text)) ||
    (/<input\b[^>]*\btype\s*=\s*(?:["']password["']|password(?=\s|>))/i.test(html) && !isSingleArticle(cleanPageHtml(html)))) {
    throw new CrawlError("challenge", "This page requires login or browser verification and cannot be crawled.");
  }
}

/** Article evidence wins over related-story links. Multiple article cards are a listing. */
export function isSingleArticle(html: string): boolean {
  if (metaContent(html, "og:type")?.toLowerCase() === "article") return true;
  const clean = cleanPageHtml(html);
  const articles = [...clean.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)];
  if (articles.length > 1) return false;
  if (articles.length === 1 && /<p\b/i.test(articles[0][1])) return true;
  // ItemList structured data often embeds Article entries; that does not make the index an article.
  if (!/"@type"\s*:\s*"(?:ItemList|CollectionPage)"/i.test(html) && /"@type"\s*:\s*"(?:NewsArticle|BlogPosting|Article)"/i.test(html)) return true;
  return hasArticleBody(clean);
}

function hasArticleBody(html: string): boolean {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1];
  if (!main || !/<h1\b/i.test(main)) return false;
  const textLength = (text: string) => text.replace(/<[^>]{0,2000}>/g, " ").replace(/\s+/g, " ").trim().length;
  const paragraphs = [...main.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => textLength(match[1]));
  const paragraphLength = paragraphs.reduce((total, length) => total + length, 0);
  const linkLength = [...main.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].reduce((total, match) => total + textLength(match[1]), 0);
  return paragraphs.length >= 2 && paragraphLength >= 200 && paragraphLength > linkLength * 2;
}