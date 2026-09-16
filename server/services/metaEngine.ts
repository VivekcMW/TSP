import type { IndustrySlug } from "@shared/schema";
import { engineRegistry } from "./engines/index.js";
import { generateText } from "./openRouter";

const SUPPORTED_VERTICALS: Array<{ slug: IndustrySlug; name: string; signals: string[] }> = [
  {
    slug: "media_advertising",
    name: "Media & Advertising",
    signals: [
      "advertising", "media buying", "programmatic", "ad tech", "martech",
      "creative agency", "brand strategy", "campaign", "media planning",
      "digital advertising", "social media marketing", "influencer marketing",
      "CTV", "OOH", "DOOH", "retail media", "performance marketing"
    ]
  },
  {
    slug: "technology_saas",
    name: "Technology & SaaS",
    signals: [
      "software", "SaaS", "cloud", "developer", "engineering", "startup",
      "AI", "machine learning", "cybersecurity", "infrastructure", "devops",
      "API", "platform", "tech company", "product engineering", "CTO"
    ]
  },
  {
    slug: "product_marketing",
    name: "Product Marketing",
    signals: [
      "product marketing", "PMM", "go-to-market", "GTM", "product launch",
      "positioning", "messaging", "competitive intelligence", "sales enablement",
      "PLG", "product-led growth", "growth marketing", "customer marketing"
    ]
  },
  {
    slug: "finance_banking",
    name: "Finance & Banking",
    signals: [
      "finance", "banking", "fintech", "investment", "wealth management",
      "trading", "capital markets", "hedge fund", "private equity", "VC",
      "CFO", "financial services", "insurance", "payments", "crypto"
    ]
  },
  {
    slug: "healthcare_pharma",
    name: "Healthcare & Pharma",
    signals: [
      "healthcare", "pharma", "pharmaceutical", "biotech", "medical device",
      "clinical", "FDA", "drug development", "health tech", "hospital",
      "patient care", "clinical trials", "life sciences", "medical"
    ]
  },
  {
    slug: "ecommerce_retail",
    name: "E-commerce & Retail",
    signals: [
      "e-commerce", "ecommerce", "retail", "DTC", "direct-to-consumer",
      "marketplace", "shopping", "fulfillment", "supply chain", "inventory",
      "omnichannel", "consumer goods", "CPG", "merchandising", "Shopify"
    ]
  }
];

export function normalizeIndustryToSlug(industry: string | null | undefined): IndustrySlug {
  if (!industry) return "other";
  
  const normalized = industry.toLowerCase().trim();
  
  for (const vertical of SUPPORTED_VERTICALS) {
    if (normalized === vertical.slug) return vertical.slug;
    if (normalized === vertical.name.toLowerCase()) return vertical.slug;
    
    const words = vertical.name.toLowerCase().split(/\s+|&/);
    if (words.some(word => word.length > 3 && normalized.includes(word))) {
      return vertical.slug;
    }
  }
  
  const slugMap: Record<string, IndustrySlug> = {
    "media": "media_advertising",
    "advertising": "media_advertising",
    "tech": "technology_saas",
    "technology": "technology_saas",
    "saas": "technology_saas",
    "software": "technology_saas",
    "product": "product_marketing",
    "marketing": "product_marketing",
    "finance": "finance_banking",
    "banking": "finance_banking",
    "fintech": "finance_banking",
    "healthcare": "healthcare_pharma",
    "pharma": "healthcare_pharma",
    "pharmaceutical": "healthcare_pharma",
    "ecommerce": "ecommerce_retail",
    "e-commerce": "ecommerce_retail",
    "retail": "ecommerce_retail",
  };
  
  for (const [keyword, slug] of Object.entries(slugMap)) {
    if (normalized.includes(keyword)) return slug;
  }
  
  return "other";
}

const META_ENGINE_PROMPT = `You are TheSocialPundit's Industry Auto-Selection Engine.

OBJECTIVE:
Analyze the user's professional focus description and their selected industry dropdown to determine the BEST content curation engine for them. Match them to one of our specialized verticals to ensure they receive highly relevant industry news and content.

INPUT:
- Industry dropdown selection (pre-qualification hint)
- Professional focus description (the user's actual expertise statement)

SUPPORTED VERTICALS (FIXED SET):
${SUPPORTED_VERTICALS.map(v => `- ${v.slug}: "${v.name}" - Key signals: ${v.signals.slice(0, 8).join(", ")}`).join("\n")}
- "other": Default/General Business (fallback when no strong match)

DECISION LOGIC:
1. The professional focus description takes PRIORITY over the dropdown selection
2. Look for strong signal words and phrases that indicate industry expertise
3. Consider job titles, company types, and specific domain terminology
4. If the description strongly contradicts the dropdown, trust the description
5. If unclear or generic, use the dropdown selection as the tiebreaker
6. Only return "other" if truly no strong match exists

RESPONSE FORMAT (JSON only, no markdown):
{
  "recommendedIndustry": "industry_slug",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation of the match",
  "matchedSignals": ["list", "of", "matched", "keywords"],
  "dropdownAligned": true/false
}`;

export interface MetaEngineResult {
  recommendedIndustry: IndustrySlug;
  confidence: number;
  reasoning: string;
  matchedSignals: string[];
  dropdownAligned: boolean;
  engineDisplayName: string;
}

export async function selectIndustryEngine(
  selectedIndustry: string,
  focusDescription: string
): Promise<MetaEngineResult> {
  const userPrompt = `DROPDOWN SELECTION: "${selectedIndustry}"
PROFESSIONAL FOCUS: "${focusDescription}"

Analyze this input and determine the best industry vertical match. Return valid JSON only.`;

  try {
    const text = await generateText(`${META_ENGINE_PROMPT}\n\n${userPrompt}`);
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[MetaEngine] Failed to parse JSON from response:", text);
      return createFallbackResult(selectedIndustry);
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    const validSlugs = SUPPORTED_VERTICALS.map(v => v.slug);
    let recommendedIndustry: IndustrySlug = parsed.recommendedIndustry;
    
    if (!validSlugs.includes(recommendedIndustry) && recommendedIndustry !== "other") {
      const matchedVertical = SUPPORTED_VERTICALS.find(v => 
        v.name.toLowerCase() === recommendedIndustry.toLowerCase() ||
        v.slug === recommendedIndustry.toLowerCase().replace(/[^a-z]/g, "_")
      );
      recommendedIndustry = matchedVertical?.slug || "other";
    }
    
    const engine = engineRegistry.getEngine(recommendedIndustry);
    
    return {
      recommendedIndustry,
      confidence: parsed.confidence || 0.7,
      reasoning: parsed.reasoning || "Matched based on professional focus analysis",
      matchedSignals: parsed.matchedSignals || [],
      dropdownAligned: parsed.dropdownAligned ?? (selectedIndustry.toLowerCase().includes(recommendedIndustry.replace("_", " "))),
      engineDisplayName: engine.config.displayName,
    };
  } catch (error) {
    console.error("[MetaEngine] Error selecting industry:", error);
    return createFallbackResult(selectedIndustry);
  }
}

function createFallbackResult(selectedIndustry: string): MetaEngineResult {
  const matchedVertical = SUPPORTED_VERTICALS.find(v => 
    selectedIndustry.toLowerCase().includes(v.name.toLowerCase().split(" ")[0].toLowerCase())
  );
  
  const recommendedIndustry: IndustrySlug = matchedVertical?.slug || "other";
  const engine = engineRegistry.getEngine(recommendedIndustry);
  
  return {
    recommendedIndustry,
    confidence: 0.5,
    reasoning: "Fallback: Using dropdown selection as primary signal",
    matchedSignals: [],
    dropdownAligned: true,
    engineDisplayName: engine.config.displayName,
  };
}

export function getAvailableVerticals() {
  return SUPPORTED_VERTICALS.map(v => ({
    slug: v.slug,
    name: v.name,
    hasSpecializedEngine: engineRegistry.hasSpecializedEngine(v.slug),
  }));
}
