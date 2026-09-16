import { BaseIndustryEngine } from "../baseEngine.js";
import type { EngineConfig } from "../types.js";

export class ProductMarketingEngine extends BaseIndustryEngine {
  readonly config: EngineConfig = {
    industry: "product_marketing",
    displayName: "Product Marketing",
    description: "Product positioning, go-to-market strategy, competitive intelligence, and customer insights",
    industryPrompt: `You are an expert analyst specializing in Product Marketing.
Focus areas: Product positioning and messaging, go-to-market strategy, competitive intelligence,
customer insights and research, sales enablement, product launches, pricing strategy,
buyer personas, market segmentation, content strategy, demand generation, and growth marketing.`,
  };
}
