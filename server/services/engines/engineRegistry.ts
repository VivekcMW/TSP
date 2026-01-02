import type { IndustrySlug } from "@shared/schema";
import type { IIndustryEngine } from "./types.js";

import { MediaAdvertisingEngine } from "./verticals/mediaAdvertisingEngine.js";
import { TechnologySaasEngine } from "./verticals/technologySaasEngine.js";
import { ProductMarketingEngine } from "./verticals/productMarketingEngine.js";
import { FinanceBankingEngine } from "./verticals/financeBankingEngine.js";
import { HealthcarePharmaEngine } from "./verticals/healthcarePharmaEngine.js";
import { EcommerceRetailEngine } from "./verticals/ecommerceRetailEngine.js";
import { DefaultEngine } from "./verticals/defaultEngine.js";

class EngineRegistry {
  private engines: Map<IndustrySlug, IIndustryEngine> = new Map();
  private defaultEngine: IIndustryEngine;

  constructor() {
    this.defaultEngine = new DefaultEngine();
    this.registerEngines();
  }

  private registerEngines(): void {
    this.engines.set("media_advertising", new MediaAdvertisingEngine());
    this.engines.set("technology_saas", new TechnologySaasEngine());
    this.engines.set("product_marketing", new ProductMarketingEngine());
    this.engines.set("finance_banking", new FinanceBankingEngine());
    this.engines.set("healthcare_pharma", new HealthcarePharmaEngine());
    this.engines.set("ecommerce_retail", new EcommerceRetailEngine());
    
    this.engines.set("consulting_services", this.defaultEngine);
    this.engines.set("real_estate", this.defaultEngine);
    this.engines.set("education_edtech", this.defaultEngine);
    this.engines.set("manufacturing", this.defaultEngine);
    this.engines.set("energy_sustainability", this.defaultEngine);
    this.engines.set("legal_services", this.defaultEngine);
    this.engines.set("nonprofit_ngo", this.defaultEngine);
    this.engines.set("government_public", this.defaultEngine);
    this.engines.set("hospitality_travel", this.defaultEngine);
    this.engines.set("entertainment_media", this.defaultEngine);
    this.engines.set("telecommunications", this.defaultEngine);
    this.engines.set("agriculture", this.defaultEngine);
    this.engines.set("other", this.defaultEngine);
  }

  getEngine(industry: IndustrySlug | string | null | undefined): IIndustryEngine {
    if (!industry) {
      return this.defaultEngine;
    }
    return this.engines.get(industry as IndustrySlug) || this.defaultEngine;
  }

  getAllEngines(): Map<IndustrySlug, IIndustryEngine> {
    return this.engines;
  }

  getAvailableIndustries(): IndustrySlug[] {
    return Array.from(this.engines.keys());
  }

  hasSpecializedEngine(industry: IndustrySlug): boolean {
    const engine = this.engines.get(industry);
    return engine !== undefined && engine !== this.defaultEngine;
  }
}

export const engineRegistry = new EngineRegistry();
