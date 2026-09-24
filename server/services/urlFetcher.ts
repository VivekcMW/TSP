import { CrawlError, fetchPublicText } from "./crawlerFetch.js";
import { cleanPageHtml, metaContent, requireReadableHtml, requireUngatedHtml } from "./crawlerHtml.js";
import { MAX_SOURCE_CHARACTERS, type SourceContentMetadata } from "./editorialEvidence.js";
import type { PublicationDate } from "@shared/article-quality";
import { extractPublicationDate } from "./articleDates";

export interface FetchedArticle {
  title: string;
  content: string;
  source: string;
  url: string;
  domain: string;
  contentMetadata?: SourceContentMetadata;
  publishedAt?: string | null;
  publicationDate?: PublicationDate;
}

/** Real article paragraphs cluster together in the HTML; nav/footer/promo <p> tags are scattered singles separated by large gaps of unrelated markup. Picking the densest cluster (not just "the first N <p> tags on the page") is what actually finds the article body on pages with no semantic <article>/<main> wrapper. */
const MIN_PARAGRAPH_LENGTH = 50;
const MAX_CLUSTER_GAP = 1500;

interface ParagraphMatch {
  text: string;
  start: number;
  end: number;
}

function extractQualifyingParagraphs(html: string): ParagraphMatch[] {
  const matches: ParagraphMatch[] = [];
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  while ((match = pRe.exec(html)) !== null) {
    const text = stripHtml(match[1]);
    if (text.length >= MIN_PARAGRAPH_LENGTH) {
      matches.push({ text, start: match.index, end: match.index + match[0].length });
    }
  }
  return matches;
}

/** Groups paragraphs that sit close together in the raw HTML, then returns the group with the most total text — the real article body, not scattered chrome. */
function densestParagraphCluster(paragraphs: ParagraphMatch[]): string {
  if (!paragraphs.length) return "";

  const clusters: ParagraphMatch[][] = [];
  let current: ParagraphMatch[] = [paragraphs[0]];
  for (let i = 1; i < paragraphs.length; i++) {
    const gap = paragraphs[i].start - paragraphs[i - 1].end;
    if (gap <= MAX_CLUSTER_GAP) {
      current.push(paragraphs[i]);
    } else {
      clusters.push(current);
      current = [paragraphs[i]];
    }
  }
  clusters.push(current);

  const best = clusters.reduce((largest, candidate) => {
    const candidateLength = candidate.reduce((sum, p) => sum + p.text.length, 0);
    const largestLength = largest.reduce((sum, p) => sum + p.text.length, 0);
    return candidateLength > largestLength ? candidate : largest;
  }, clusters[0]);

  return best.map((p) => p.text).join("\n\n");
}

export async function fetchArticleFromUrl(url: string, signal?: AbortSignal): Promise<FetchedArticle> {
  const page = await fetchPublicText(url, { signal });
  requireReadableHtml(page);
  return extractArticleFromHtml(page.text, page.url);
}

export function extractArticleFromHtml(rawHtml: string, url: string): FetchedArticle {
  requireUngatedHtml(rawHtml);
  const urlObj = new URL(url);
  const domain = urlObj.hostname.replace(/^www\./, "");
  
  const sourceName = domain
    .split(".")[0]
    .split("-")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  const date = extractPublicationDate(rawHtml, url);
  const html = cleanPageHtml(rawHtml);
  const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  const title = titleMatch?.[1]?.trim() || "Untitled Article";
  const ogTitle = metaContent(html, "og:title");
  // Prefer the publisher's own name ("Campaign India") over one derived from the domain ("Campaignindia").
  const declaredName = decodeHtmlEntities(metaContent(html, "og:site_name") ?? metaContent(html, "application-name") ?? "").trim();
  const source = declaredName.length >= 2 && declaredName.length <= 60 && !/^https?:\/\//i.test(declaredName) ? declaredName : sourceName;
  const articleMatch = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html);
  const mainMatch = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
  const bodyHtml = articleMatch?.[1] ?? mainMatch?.[1] ?? html;
  // Headings, links and controls alone are not an article, even inside <main>.
  // Count actual body prose, not metadata teasers or navigation labels.
  const prose = decodeHtmlEntities(stripHtml(bodyHtml
    .replace(/<(a|h[1-6]|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<input\b[^>]*>/gi, " "))).trim();
  if (prose.length < 80 || (!articleMatch && mainMatch && extractQualifyingParagraphs(bodyHtml).length === 0) ||
    /^(?:please\s+)?(?:sign[ -]?in|log[ -]?in|subscribe)\s+to\s+(?:read|continue|access|unlock)/i.test(prose)) {
    throw new CrawlError("quality", "No readable article body was found; this page contains only a teaser, login prompt, navigation, or insufficient public content.");
  }
  let extractionMethod: SourceContentMetadata["extractionMethod"] = "paragraph_cluster";
  let content: string;
  if (articleMatch) {
    extractionMethod = "article";
    content = stripHtml(articleMatch[1]);
  } else if (mainMatch) {
    extractionMethod = "main";
    content = stripHtml(mainMatch[1]);
  } else {
    content = densestParagraphCluster(extractQualifyingParagraphs(html));
  }
  content = decodeHtmlEntities(content).trim();
  const originalLength = content.length;
  content = content.slice(0, MAX_SOURCE_CHARACTERS);
  if (!content.trim() || /^(?:loading[.\s…]*|please enable javascript[.\s]*)$/i.test(content)) {
    throw new CrawlError("content", "No readable article content was found. The page may require JavaScript, login, or a subscription.");
  }
  return {
    title: decodeHtmlEntities(ogTitle || title), content, source, url, domain,
    publishedAt: date.publishedAt, publicationDate: date,
    contentMetadata: { extractionMethod, originalLength, retainedLength: content.length, truncated: originalLength > content.length },
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote)>|<br\b[^>]{0,100}>/gi, "\n\n")
    .replace(/<[^>]{0,2000}>/g, " ")
    .split(/\n+/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n\n")
    .trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
}
