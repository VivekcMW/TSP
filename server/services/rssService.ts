import Parser from "rss-parser";
import { validateUrlSync } from "./urlValidator.js";

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
  { name: "PPC Land", url: "https://ppc.land/rss/", category: "Ad Tech" },
];

async function fetchFeed(feed: RSSFeed): Promise<RSSArticle[]> {
  try {
    const result = await parser.parseURL(feed.url);
    const items = (result.items || []).slice(0, 15).map((item) => ({
      title: item.title || "Untitled",
      link: item.link || "",
      pubDate: item.pubDate || new Date().toISOString(),
      source: feed.name,
      content: item.contentSnippet || item.content || item.summary || "",
      categories: item.categories || [feed.category],
    }));
    
    const validItems = items.filter((item) => {
      if (!item.link) return false;
      return validateUrlSync(item.link);
    });
    
    return validItems.slice(0, 10);
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

export interface HotTrend {
  topic: string;
  count: number;
  articles: { title: string; source: string; link: string }[];
}

export async function getHotTrends(maxTrends: number = 5): Promise<HotTrend[]> {
  const articles = await fetchAllFeeds();
  
  const trendKeywords = [
    { keyword: "artificial intelligence", display: "AI" },
    { keyword: "machine learning", display: "Machine Learning" },
    { keyword: "generative ai", display: "Generative AI" },
    { keyword: "chatgpt", display: "ChatGPT" },
    { keyword: "gemini", display: "Gemini" },
    { keyword: "google ads", display: "Google Ads" },
    { keyword: "meta ads", display: "Meta Ads" },
    { keyword: "tiktok", display: "TikTok" },
    { keyword: "youtube", display: "YouTube" },
    { keyword: "twitter", display: "Twitter/X" },
    { keyword: "programmatic", display: "Programmatic" },
    { keyword: "connected tv", display: "CTV" },
    { keyword: "streaming", display: "Streaming" },
    { keyword: "retail media", display: "Retail Media" },
    { keyword: "privacy", display: "Privacy" },
    { keyword: "cookieless", display: "Cookieless" },
    { keyword: "first-party data", display: "First-Party Data" },
    { keyword: "influencer", display: "Influencer Marketing" },
    { keyword: "creator economy", display: "Creator Economy" },
    { keyword: "measurement", display: "Measurement" },
    { keyword: "attribution", display: "Attribution" },
    { keyword: "brand safety", display: "Brand Safety" },
    { keyword: "ad fraud", display: "Ad Fraud" },
    { keyword: "layoffs", display: "Industry Layoffs" },
    { keyword: "acquisition", display: "M&A" },
  ];
  
  const trendMap = new Map<string, { count: number; articles: { title: string; source: string; link: string }[] }>();
  
  articles.forEach((article) => {
    const text = `${article.title} ${article.content}`.toLowerCase();
    trendKeywords.forEach(({ keyword, display }) => {
      const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(text)) {
        const existing = trendMap.get(display) || { count: 0, articles: [] };
        existing.count++;
        if (existing.articles.length < 3) {
          existing.articles.push({
            title: article.title,
            source: article.source,
            link: article.link,
          });
        }
        trendMap.set(display, existing);
      }
    });
  });
  
  const trends: HotTrend[] = Array.from(trendMap.entries())
    .map(([topic, data]) => ({ topic, count: data.count, articles: data.articles }))
    .filter((t) => t.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, maxTrends);
  
  return trends;
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
