import { BaseIndustryEngine } from "../baseEngine.js";
import type { EngineConfig } from "../types.js";

export class HealthcarePharmaEngine extends BaseIndustryEngine {
  readonly config: EngineConfig = {
    industry: "healthcare_pharma",
    displayName: "Healthcare & Pharma",
    description: "Healthcare technology, pharmaceuticals, biotech, and medical innovation",
    defaultFeeds: [
      { name: "STAT News", url: "https://www.statnews.com/feed/", category: "Healthcare" },
      { name: "Fierce Healthcare", url: "https://www.fiercehealthcare.com/rss.xml", category: "Healthcare" },
      { name: "Fierce Pharma", url: "https://www.fiercepharma.com/rss.xml", category: "Pharma" },
      { name: "Healthcare IT News", url: "https://www.healthcareitnews.com/feed", category: "Health IT" },
      { name: "MedCity News", url: "https://medcitynews.com/feed/", category: "Healthcare" },
      { name: "BioPharma Dive", url: "https://www.biopharmadive.com/feeds/news/", category: "Biotech" },
      { name: "Endpoints News", url: "https://endpts.com/feed/", category: "Biotech" },
      { name: "Pharma Times", url: "https://www.pharmatimes.com/rss", category: "Pharma" },
      { name: "Healthcare Dive", url: "https://www.healthcaredive.com/feeds/news/", category: "Healthcare" },
      { name: "Drug Discovery News", url: "https://www.drugdiscoverynews.com/feed", category: "Drug Discovery" },
    ],
    trendKeywords: [
      { keyword: "artificial intelligence", display: "AI in Healthcare" },
      { keyword: "telemedicine", display: "Telemedicine" },
      { keyword: "digital health", display: "Digital Health" },
      { keyword: "clinical trial", display: "Clinical Trials" },
      { keyword: "fda approval", display: "FDA Approvals" },
      { keyword: "drug discovery", display: "Drug Discovery" },
      { keyword: "gene therapy", display: "Gene Therapy" },
      { keyword: "mrna", display: "mRNA Technology" },
      { keyword: "precision medicine", display: "Precision Medicine" },
      { keyword: "mental health", display: "Mental Health" },
      { keyword: "healthcare costs", display: "Healthcare Costs" },
      { keyword: "biotech", display: "Biotech" },
      { keyword: "ehr", display: "EHR/EMR" },
      { keyword: "value-based care", display: "Value-Based Care" },
      { keyword: "patient experience", display: "Patient Experience" },
      { keyword: "oncology", display: "Oncology" },
      { keyword: "vaccine", display: "Vaccines" },
      { keyword: "rare disease", display: "Rare Diseases" },
      { keyword: "healthcare equity", display: "Health Equity" },
      { keyword: "payer", display: "Payers & Insurance" },
    ],
    industryPrompt: `You are an expert analyst specializing in Healthcare & Pharma.
Focus areas: Healthcare technology, pharmaceuticals, biotechnology, drug discovery,
clinical trials, FDA regulations, digital health, telemedicine, precision medicine,
health IT systems, payer-provider dynamics, and healthcare policy.`,
  };
}
