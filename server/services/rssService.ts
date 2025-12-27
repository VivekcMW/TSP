import Parser from "rss-parser";

const parser = new Parser({
  timeout: 10000,
  headers: {
    "User-Agent": "TheSocialPundit/1.0 (News Aggregator for Media Professionals)",
  },
});

export interface RSSArticle {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  content: string;
  categories?: string[];
}

export interface RSSFeed {
  name: string;
  url: string;
  category: string;
}

export const MEDIA_ADVERTISING_FEEDS: RSSFeed[] = [
  { name: "Adweek", url: "https://www.adweek.com/feed/", category: "Advertising" },
  { name: "Digiday", url: "https://digiday.com/feed/", category: "Digital Media" },
  { name: "Ad Age", url: "https://adage.com/arc/outboundfeeds/rss/", category: "Advertising" },
  { name: "The Drum", url: "https://www.thedrum.com/feeds/all.rss", category: "Marketing" },
  { name: "Campaign", url: "https://www.campaignlive.co.uk/rss", category: "Advertising" },
  { name: "Marketing Week", url: "https://www.marketingweek.com/feed/", category: "Marketing" },
  { name: "MediaPost", url: "https://www.mediapost.com/rss/publications/", category: "Media" },
  { name: "ExchangeWire", url: "https://www.exchangewire.com/feed/", category: "Ad Tech" },
  { name: "Martech", url: "https://martech.org/feed/", category: "MarTech" },
  { name: "Search Engine Land", url: "https://searchengineland.com/feed", category: "Search Marketing" },
];

async function fetchFeed(feed: RSSFeed): Promise<RSSArticle[]> {
  try {
    const result = await parser.parseURL(feed.url);
    return (result.items || []).slice(0, 10).map((item) => ({
      title: item.title || "Untitled",
      link: item.link || "",
      pubDate: item.pubDate || new Date().toISOString(),
      source: feed.name,
      content: item.contentSnippet || item.content || item.summary || "",
      categories: item.categories || [feed.category],
    }));
  } catch (error) {
    console.error(`Failed to fetch RSS feed from ${feed.name}:`, error instanceof Error ? error.message : error);
    return [];
  }
}

export async function fetchAllFeeds(): Promise<RSSArticle[]> {
  const feedPromises = MEDIA_ADVERTISING_FEEDS.map((feed) => fetchFeed(feed));
  const results = await Promise.allSettled(feedPromises);
  
  const articles: RSSArticle[] = [];
  results.forEach((result) => {
    if (result.status === "fulfilled") {
      articles.push(...result.value);
    }
  });
  
  articles.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
  
  return articles;
}

export async function fetchFeedsForPublications(publicationNames: string[]): Promise<RSSArticle[]> {
  const lowerNames = publicationNames.map((n) => n.toLowerCase());
  const matchedFeeds = MEDIA_ADVERTISING_FEEDS.filter((feed) =>
    lowerNames.some((name) => 
      feed.name.toLowerCase().includes(name) || name.includes(feed.name.toLowerCase())
    )
  );
  
  if (matchedFeeds.length === 0) {
    return fetchAllFeeds();
  }
  
  const feedPromises = matchedFeeds.map((feed) => fetchFeed(feed));
  const results = await Promise.allSettled(feedPromises);
  
  const articles: RSSArticle[] = [];
  results.forEach((result) => {
    if (result.status === "fulfilled") {
      articles.push(...result.value);
    }
  });
  
  articles.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
  
  return articles;
}

export function matchArticlesToKeywords(
  articles: RSSArticle[],
  keywords: string[],
  maxResults: number = 8
): RSSArticle[] {
  const keywordSet = new Set(keywords.map((k) => k.toLowerCase()));
  
  const scored = articles.map((article) => {
    const text = `${article.title} ${article.content}`.toLowerCase();
    let score = 0;
    const matchedKeywords: string[] = [];
    
    keywords.forEach((keyword) => {
      const keywordLower = keyword.toLowerCase();
      if (text.includes(keywordLower)) {
        score += 2;
        matchedKeywords.push(keyword);
      }
      const words = keywordLower.split(/\s+/);
      words.forEach((word) => {
        if (word.length > 3 && text.includes(word)) {
          score += 0.5;
        }
      });
    });
    
    return { article, score, matchedKeywords };
  });
  
  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((item) => ({
      ...item.article,
      categories: item.matchedKeywords.length > 0 ? item.matchedKeywords : item.article.categories,
    }));
}
