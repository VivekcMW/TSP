import { assertPublicHttpUrl } from "./urlValidator.js";

export interface FetchedArticle {
  title: string;
  content: string;
  source: string;
  url: string;
  domain: string;
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

  return best.map((p) => p.text).join(" ");
}

export async function fetchArticleFromUrl(url: string): Promise<FetchedArticle> {
  const urlObj = new URL(url);
  const domain = urlObj.hostname.replace(/^www\./, "");
  
  const sourceName = domain
    .split(".")[0]
    .split("-")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  try {
    const guard = await assertPublicHttpUrl(url);
    if (!guard.ok) {
      throw new Error(`Refused to fetch ${url}: ${guard.reason}`);
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TheSocialPundit/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status}`);
    }

    const html = await response.text();
    
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch 
      ? decodeHtmlEntities(titleMatch[1].trim())
      : "Untitled Article";

    const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    const ogTitle = ogTitleMatch ? decodeHtmlEntities(ogTitleMatch[1]) : null;

    const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
    const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    const description = ogDescMatch?.[1] || metaDescMatch?.[1] || "";

    let content = "";

    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (articleMatch) {
      content = stripHtml(articleMatch[1]);
    } else if (mainMatch) {
      content = stripHtml(mainMatch[1]);
    } else {
      content = densestParagraphCluster(extractQualifyingParagraphs(html));
    }

    if (!content && description) {
      content = decodeHtmlEntities(description);
    }

    content = content.slice(0, 3000);

    return {
      title: ogTitle || title,
      content: content || description || "Article content could not be extracted.",
      source: sourceName,
      url,
      domain,
    };
  } catch (error) {
    console.error("Error fetching article:", error);
    return {
      title: "Article from " + sourceName,
      content: "Unable to extract article content. Please provide context manually.",
      source: sourceName,
      url,
      domain,
    };
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
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
