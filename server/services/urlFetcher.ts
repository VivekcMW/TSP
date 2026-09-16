export interface FetchedArticle {
  title: string;
  content: string;
  source: string;
  url: string;
  domain: string;
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
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TheSocialPundit/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
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
    if (articleMatch) {
      content = stripHtml(articleMatch[1]);
    } else {
      const pTags = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
      content = pTags
        .map(p => stripHtml(p))
        .filter(text => text.length > 50)
        .slice(0, 10)
        .join(" ");
    }

    if (!content && description) {
      content = decodeHtmlEntities(description);
    }

    content = content.slice(0, 2000);

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
