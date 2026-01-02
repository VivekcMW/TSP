import { BaseIndustryEngine } from "../baseEngine.js";
import type { EngineConfig } from "../types.js";

export class ProductMarketingEngine extends BaseIndustryEngine {
  readonly config: EngineConfig = {
    industry: "product_marketing",
    displayName: "Product Marketing",
    description: "Product positioning, go-to-market strategy, competitive intelligence, and customer insights",
    defaultFeeds: [
      { name: "Product Marketing Alliance", url: "https://www.productmarketingalliance.com/feed/", category: "Product Marketing" },
      { name: "HubSpot Blog", url: "https://blog.hubspot.com/marketing/rss.xml", category: "Marketing" },
      { name: "Content Marketing Institute", url: "https://contentmarketinginstitute.com/feed/", category: "Content Marketing" },
      { name: "MarketingProfs", url: "https://www.marketingprofs.com/rss/", category: "Marketing" },
      { name: "First Round Review", url: "https://review.firstround.com/feed.xml", category: "Startup Strategy" },
      { name: "Lenny's Newsletter", url: "https://www.lennysnewsletter.com/feed", category: "Product" },
      { name: "Reforge Blog", url: "https://www.reforge.com/blog/rss.xml", category: "Growth" },
      { name: "OpenView Blog", url: "https://openviewpartners.com/blog/feed/", category: "PLG" },
      { name: "Mind the Product", url: "https://www.mindtheproduct.com/feed/", category: "Product Management" },
      { name: "Intercom Blog", url: "https://www.intercom.com/blog/feed/", category: "Product" },
    ],
    trendKeywords: [
      { keyword: "product-led growth", display: "Product-Led Growth" },
      { keyword: "go-to-market", display: "Go-to-Market" },
      { keyword: "positioning", display: "Positioning" },
      { keyword: "competitive intelligence", display: "Competitive Intel" },
      { keyword: "customer research", display: "Customer Research" },
      { keyword: "messaging", display: "Messaging" },
      { keyword: "launch", display: "Product Launch" },
      { keyword: "pricing", display: "Pricing Strategy" },
      { keyword: "buyer persona", display: "Buyer Personas" },
      { keyword: "sales enablement", display: "Sales Enablement" },
      { keyword: "case study", display: "Case Studies" },
      { keyword: "win/loss", display: "Win/Loss Analysis" },
      { keyword: "market research", display: "Market Research" },
      { keyword: "analyst relations", display: "Analyst Relations" },
      { keyword: "competitive analysis", display: "Competitive Analysis" },
      { keyword: "customer story", display: "Customer Stories" },
      { keyword: "demand generation", display: "Demand Gen" },
      { keyword: "content strategy", display: "Content Strategy" },
      { keyword: "brand", display: "Brand Marketing" },
      { keyword: "growth", display: "Growth Strategy" },
    ],
    industryPrompt: `You are an expert analyst specializing in Product Marketing.
Focus areas: Product positioning and messaging, go-to-market strategy, competitive intelligence,
customer insights and research, sales enablement, product launches, pricing strategy,
buyer personas, market segmentation, content strategy, demand generation, and growth marketing.`,
  };
}
