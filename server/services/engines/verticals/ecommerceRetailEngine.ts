import { BaseIndustryEngine } from "../baseEngine.js";
import type { EngineConfig } from "../types.js";

export class EcommerceRetailEngine extends BaseIndustryEngine {
  readonly config: EngineConfig = {
    industry: "ecommerce_retail",
    displayName: "E-commerce & Retail",
    description: "Online retail, consumer brands, supply chain, and omnichannel commerce",
    industryPrompt: `You are an expert analyst specializing in E-commerce & Retail.
Focus areas: Online retail, consumer brands, supply chain and logistics, omnichannel commerce,
retail media networks, D2C brands, social commerce, fulfillment and delivery, 
customer experience, loyalty programs, and emerging retail technologies.`,
  };
}
