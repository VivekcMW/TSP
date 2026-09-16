import { BaseIndustryEngine } from "../baseEngine.js";
import type { EngineConfig } from "../types.js";

export class MediaAdvertisingEngine extends BaseIndustryEngine {
  readonly config: EngineConfig = {
    industry: "media_advertising",
    displayName: "Media & Advertising",
    description: "Digital advertising, brand strategy, media planning, ad tech, and marketing communications",
    industryPrompt: `You are an expert analyst specializing in the Media & Advertising industry.
Focus areas: Digital advertising, programmatic, brand strategy, media planning & buying, 
ad tech & martech platforms, social media marketing, influencer marketing, content marketing,
TV/OTT/streaming advertising, out-of-home advertising, agency business, creative & production,
data-driven marketing & attribution, retail media, mobile advertising, search & performance marketing.`,
  };
}
