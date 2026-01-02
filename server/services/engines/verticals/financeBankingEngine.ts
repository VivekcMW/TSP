import { BaseIndustryEngine } from "../baseEngine.js";
import type { EngineConfig } from "../types.js";

export class FinanceBankingEngine extends BaseIndustryEngine {
  readonly config: EngineConfig = {
    industry: "finance_banking",
    displayName: "Finance & Banking",
    description: "Financial services, fintech, banking, investments, and regulatory compliance",
    defaultFeeds: [
      { name: "Financial Times", url: "https://www.ft.com/rss/home", category: "Finance" },
      { name: "Bloomberg", url: "https://feeds.bloomberg.com/markets/news.rss", category: "Markets" },
      { name: "Finextra", url: "https://www.finextra.com/rss/headlines.aspx", category: "Fintech" },
      { name: "American Banker", url: "https://www.americanbanker.com/feed", category: "Banking" },
      { name: "TechCrunch Fintech", url: "https://techcrunch.com/category/fintech/feed/", category: "Fintech" },
      { name: "PYMNTS", url: "https://www.pymnts.com/feed/", category: "Payments" },
      { name: "The Banker", url: "https://www.thebanker.com/rss", category: "Banking" },
      { name: "Banking Dive", url: "https://www.bankingdive.com/feeds/news/", category: "Banking" },
      { name: "Finovate", url: "https://finovate.com/feed/", category: "Fintech" },
      { name: "Payments Journal", url: "https://www.paymentsjournal.com/feed/", category: "Payments" },
    ],
    trendKeywords: [
      { keyword: "fintech", display: "Fintech" },
      { keyword: "digital banking", display: "Digital Banking" },
      { keyword: "cryptocurrency", display: "Cryptocurrency" },
      { keyword: "blockchain", display: "Blockchain" },
      { keyword: "open banking", display: "Open Banking" },
      { keyword: "embedded finance", display: "Embedded Finance" },
      { keyword: "buy now pay later", display: "BNPL" },
      { keyword: "payments", display: "Payments" },
      { keyword: "neobank", display: "Neobanks" },
      { keyword: "regtech", display: "RegTech" },
      { keyword: "compliance", display: "Compliance" },
      { keyword: "anti-money laundering", display: "AML" },
      { keyword: "fraud", display: "Fraud Prevention" },
      { keyword: "interest rate", display: "Interest Rates" },
      { keyword: "federal reserve", display: "Fed Policy" },
      { keyword: "ipo", display: "IPOs" },
      { keyword: "merger", display: "M&A" },
      { keyword: "wealth management", display: "Wealth Management" },
      { keyword: "robo-advisor", display: "Robo-Advisors" },
      { keyword: "defi", display: "DeFi" },
    ],
    industryPrompt: `You are an expert analyst specializing in Finance & Banking.
Focus areas: Financial services, fintech innovation, digital banking transformation,
payments and transactions, cryptocurrency and blockchain, open banking, embedded finance,
regulatory compliance, risk management, wealth management, lending, and investment banking.`,
  };
}
