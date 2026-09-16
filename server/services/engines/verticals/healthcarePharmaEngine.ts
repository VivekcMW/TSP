import { BaseIndustryEngine } from "../baseEngine.js";
import type { EngineConfig } from "../types.js";

export class HealthcarePharmaEngine extends BaseIndustryEngine {
  readonly config: EngineConfig = {
    industry: "healthcare_pharma",
    displayName: "Healthcare & Pharma",
    description: "Healthcare technology, pharmaceuticals, biotech, and medical innovation",
    industryPrompt: `You are an expert analyst specializing in Healthcare & Pharma.
Focus areas: Healthcare technology, pharmaceuticals, biotechnology, drug discovery,
clinical trials, FDA regulations, digital health, telemedicine, precision medicine,
health IT systems, payer-provider dynamics, and healthcare policy.`,
  };
}
