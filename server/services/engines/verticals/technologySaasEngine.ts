import { BaseIndustryEngine } from "../baseEngine.js";
import type { EngineConfig } from "../types.js";

export class TechnologySaasEngine extends BaseIndustryEngine {
  readonly config: EngineConfig = {
    industry: "technology_saas",
    displayName: "Technology & SaaS",
    description: "Enterprise software, cloud computing, developer tools, and B2B technology",
    industryPrompt: `You are an expert analyst specializing in the Technology & SaaS industry.
Focus areas: Enterprise software, cloud computing, developer tools, B2B technology platforms,
AI/ML products, cybersecurity solutions, DevOps & infrastructure, product-led growth strategies,
startup ecosystem, venture capital, tech M&A, digital transformation, and emerging technologies.`,
  };
}
