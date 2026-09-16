import { BaseIndustryEngine } from "../baseEngine.js";
import type { EngineConfig } from "../types.js";

export class FinanceBankingEngine extends BaseIndustryEngine {
  readonly config: EngineConfig = {
    industry: "finance_banking",
    displayName: "Finance & Banking",
    description: "Financial services, fintech, banking, investments, and regulatory compliance",
    industryPrompt: `You are an expert analyst specializing in Finance & Banking.
Focus areas: Financial services, fintech innovation, digital banking transformation,
payments and transactions, cryptocurrency and blockchain, open banking, embedded finance,
regulatory compliance, risk management, wealth management, lending, and investment banking.`,
  };
}
