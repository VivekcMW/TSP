import { BaseIndustryEngine } from "../baseEngine.js";
import type { EngineConfig } from "../types.js";

export class EcommerceRetailEngine extends BaseIndustryEngine {
  readonly config: EngineConfig = {
    industry: "ecommerce_retail",
    displayName: "E-commerce & Retail",
    description: "Online retail, consumer brands, supply chain, and omnichannel commerce",
    defaultFeeds: [
      { name: "Retail Dive", url: "https://www.retaildive.com/feeds/news/", category: "Retail" },
      { name: "Digital Commerce 360", url: "https://www.digitalcommerce360.com/feed/", category: "E-commerce" },
      { name: "Retail TouchPoints", url: "https://www.retailtouchpoints.com/feed", category: "Retail" },
      { name: "Modern Retail", url: "https://www.modernretail.co/feed/", category: "Retail" },
      { name: "Chain Store Age", url: "https://chainstoreage.com/feed", category: "Retail" },
      { name: "Retail Week", url: "https://www.retail-week.com/rss", category: "Retail" },
      { name: "Ecommerce Times", url: "https://www.ecommercetimes.com/rss-feed/all", category: "E-commerce" },
      { name: "Practical Ecommerce", url: "https://www.practicalecommerce.com/feed", category: "E-commerce" },
      { name: "Supply Chain Dive", url: "https://www.supplychaindive.com/feeds/news/", category: "Supply Chain" },
      { name: "Glossy", url: "https://www.glossy.co/feed/", category: "Fashion Retail" },
    ],
    trendKeywords: [
      { keyword: "ecommerce", display: "E-commerce" },
      { keyword: "omnichannel", display: "Omnichannel" },
      { keyword: "retail media", display: "Retail Media" },
      { keyword: "amazon", display: "Amazon" },
      { keyword: "shopify", display: "Shopify" },
      { keyword: "supply chain", display: "Supply Chain" },
      { keyword: "last mile", display: "Last Mile Delivery" },
      { keyword: "fulfillment", display: "Fulfillment" },
      { keyword: "d2c", display: "D2C Brands" },
      { keyword: "direct to consumer", display: "DTC" },
      { keyword: "live shopping", display: "Live Shopping" },
      { keyword: "social commerce", display: "Social Commerce" },
      { keyword: "personalization", display: "Personalization" },
      { keyword: "loyalty", display: "Loyalty Programs" },
      { keyword: "inventory", display: "Inventory Management" },
      { keyword: "returns", display: "Returns & Reverse Logistics" },
      { keyword: "checkout", display: "Checkout Experience" },
      { keyword: "sustainability", display: "Sustainable Retail" },
      { keyword: "brick and mortar", display: "Physical Retail" },
      { keyword: "consumer", display: "Consumer Trends" },
    ],
    industryPrompt: `You are an expert analyst specializing in E-commerce & Retail.
Focus areas: Online retail, consumer brands, supply chain and logistics, omnichannel commerce,
retail media networks, D2C brands, social commerce, fulfillment and delivery, 
customer experience, loyalty programs, and emerging retail technologies.`,
  };
}
