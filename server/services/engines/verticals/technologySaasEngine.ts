import { BaseIndustryEngine } from "../baseEngine.js";
import type { EngineConfig } from "../types.js";

export class TechnologySaasEngine extends BaseIndustryEngine {
  readonly config: EngineConfig = {
    industry: "technology_saas",
    displayName: "Technology & SaaS",
    description: "Enterprise software, cloud computing, developer tools, and B2B technology",
    defaultFeeds: [
      { name: "TechCrunch", url: "https://techcrunch.com/feed/", category: "Tech News" },
      { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", category: "Tech News" },
      { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", category: "Tech News" },
      { name: "Wired", url: "https://www.wired.com/feed/rss", category: "Tech News" },
      { name: "VentureBeat", url: "https://venturebeat.com/feed/", category: "Enterprise Tech" },
      { name: "SaaStr", url: "https://www.saastr.com/feed/", category: "SaaS" },
      { name: "Hacker News", url: "https://hnrss.org/frontpage", category: "Developer" },
      { name: "InfoQ", url: "https://feed.infoq.com/", category: "Enterprise" },
      { name: "The New Stack", url: "https://thenewstack.io/feed/", category: "Cloud Native" },
      { name: "Protocol", url: "https://www.protocol.com/feeds/feed.rss", category: "Enterprise Tech" },
    ],
    trendKeywords: [
      { keyword: "artificial intelligence", display: "AI" },
      { keyword: "machine learning", display: "Machine Learning" },
      { keyword: "generative ai", display: "Generative AI" },
      { keyword: "large language model", display: "LLMs" },
      { keyword: "cloud computing", display: "Cloud Computing" },
      { keyword: "kubernetes", display: "Kubernetes" },
      { keyword: "devops", display: "DevOps" },
      { keyword: "cybersecurity", display: "Cybersecurity" },
      { keyword: "saas", display: "SaaS" },
      { keyword: "product-led growth", display: "PLG" },
      { keyword: "api", display: "APIs" },
      { keyword: "microservices", display: "Microservices" },
      { keyword: "serverless", display: "Serverless" },
      { keyword: "edge computing", display: "Edge Computing" },
      { keyword: "ipo", display: "Tech IPOs" },
      { keyword: "startup", display: "Startups" },
      { keyword: "venture capital", display: "VC Funding" },
      { keyword: "acquisition", display: "M&A" },
      { keyword: "layoffs", display: "Tech Layoffs" },
      { keyword: "open source", display: "Open Source" },
    ],
    industryPrompt: `You are an expert analyst specializing in the Technology & SaaS industry.
Focus areas: Enterprise software, cloud computing, developer tools, B2B technology platforms,
AI/ML products, cybersecurity solutions, DevOps & infrastructure, product-led growth strategies,
startup ecosystem, venture capital, tech M&A, digital transformation, and emerging technologies.`,
  };
}
