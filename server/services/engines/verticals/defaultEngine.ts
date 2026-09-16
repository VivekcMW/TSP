import { BaseIndustryEngine } from "../baseEngine.js";
import type { EngineConfig } from "../types.js";

export class DefaultEngine extends BaseIndustryEngine {
  readonly config: EngineConfig = {
    industry: "other",
    displayName: "General Business",
    description: "Cross-industry business news and professional insights",
    industryPrompt: `You are an expert analyst covering general business and professional topics.
Focus areas: Business strategy, leadership, innovation, digital transformation, 
workplace trends, entrepreneurship, marketing, sales, and cross-industry insights.`,
  };
}
