import { BaseIndustryEngine } from "../baseEngine.js";
import type { EngineConfig } from "../types.js";

export class MediaAdvertisingEngine extends BaseIndustryEngine {
  readonly config: EngineConfig = {
    industry: "media_advertising",
    displayName: "Media & Advertising",
    description: "Digital advertising, brand strategy, media planning, ad tech, and marketing communications",
    defaultFeeds: [
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
    ],
    trendKeywords: [
      { keyword: "artificial intelligence", display: "AI in Advertising" },
      { keyword: "generative ai", display: "Generative AI" },
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
      { keyword: "google ads", display: "Google Ads" },
      { keyword: "meta ads", display: "Meta Ads" },
      { keyword: "tiktok", display: "TikTok" },
      { keyword: "youtube", display: "YouTube" },
      { keyword: "twitter", display: "Twitter/X" },
    ],
    industryPrompt: `You are an expert analyst specializing in the Media & Advertising industry.
Focus areas: Digital advertising, programmatic, brand strategy, media planning & buying, 
ad tech & martech platforms, social media marketing, influencer marketing, content marketing,
TV/OTT/streaming advertising, out-of-home advertising, agency business, creative & production,
data-driven marketing & attribution, retail media, mobile advertising, search & performance marketing.`,
  };
}
