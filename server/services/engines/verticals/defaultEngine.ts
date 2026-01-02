import { BaseIndustryEngine } from "../baseEngine.js";
import type { EngineConfig } from "../types.js";

export class DefaultEngine extends BaseIndustryEngine {
  readonly config: EngineConfig = {
    industry: "other",
    displayName: "General Business",
    description: "Cross-industry business news and professional insights",
    defaultFeeds: [
      { name: "Harvard Business Review", url: "https://hbr.org/resources/xml/rss/rss.xml", category: "Business" },
      { name: "Fast Company", url: "https://www.fastcompany.com/rss", category: "Business" },
      { name: "Inc.", url: "https://www.inc.com/rss/", category: "Business" },
      { name: "Forbes", url: "https://www.forbes.com/innovation/feed/", category: "Business" },
      { name: "Business Insider", url: "https://feeds.businessinsider.com/businessinsider", category: "Business" },
      { name: "Entrepreneur", url: "https://www.entrepreneur.com/latest.rss", category: "Business" },
      { name: "MIT Sloan", url: "https://sloanreview.mit.edu/feed/", category: "Management" },
      { name: "McKinsey Insights", url: "https://www.mckinsey.com/insights/rss", category: "Strategy" },
      { name: "Quartz", url: "https://qz.com/feed/", category: "Business" },
      { name: "Fortune", url: "https://fortune.com/feed/", category: "Business" },
    ],
    trendKeywords: [
      { keyword: "artificial intelligence", display: "AI" },
      { keyword: "leadership", display: "Leadership" },
      { keyword: "remote work", display: "Remote Work" },
      { keyword: "hybrid work", display: "Hybrid Work" },
      { keyword: "sustainability", display: "Sustainability" },
      { keyword: "digital transformation", display: "Digital Transformation" },
      { keyword: "innovation", display: "Innovation" },
      { keyword: "startup", display: "Startups" },
      { keyword: "entrepreneurship", display: "Entrepreneurship" },
      { keyword: "management", display: "Management" },
      { keyword: "strategy", display: "Strategy" },
      { keyword: "hiring", display: "Hiring & Talent" },
      { keyword: "layoffs", display: "Workforce Changes" },
      { keyword: "economy", display: "Economy" },
      { keyword: "inflation", display: "Inflation" },
      { keyword: "supply chain", display: "Supply Chain" },
      { keyword: "customer experience", display: "Customer Experience" },
      { keyword: "marketing", display: "Marketing" },
      { keyword: "sales", display: "Sales" },
      { keyword: "productivity", display: "Productivity" },
    ],
    industryPrompt: `You are an expert analyst covering general business and professional topics.
Focus areas: Business strategy, leadership, innovation, digital transformation, 
workplace trends, entrepreneurship, marketing, sales, and cross-industry insights.`,
  };
}
