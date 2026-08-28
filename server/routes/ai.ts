import type { Express } from "express";
import { aiGenerationRateLimit } from "../middlewares/rateLimit";
import { requireDbUser } from "../middlewares/requireDbUser";
import { getAvailableVerticals, normalizeIndustryToSlug, selectIndustryEngine } from "../services/metaEngine";
import { analyzeProfessionalIdentity, generatePostContent } from "../services/punditBrain";
import { type PlatformKey } from "../services/punditBrain";

export function registerAiRoutes(app: Express) {
  app.post("/api/ai/analyze-identity", requireDbUser, aiGenerationRateLimit, async (req: any, res) => {
    try {
      const { focusDescription, selectedIndustry } = req.body;
      
      if (!focusDescription || focusDescription.length < 10) {
        return res.status(400).json({ message: "Please provide a description of at least 10 characters" });
      }
      
      const industrySlug = normalizeIndustryToSlug(selectedIndustry);
      const [analysis, engineSelection] = await Promise.all([
        analyzeProfessionalIdentity(focusDescription, industrySlug),
        selectIndustryEngine(selectedIndustry || "Other", focusDescription),
      ]);
      
      res.json({
        primaryIndustry: analysis.primaryIndustry,
        confidence: analysis.confidence,
        subDomains: analysis.subDomains,
        keywords: analysis.keywords.slice(0, 20),
        publications: analysis.publications.slice(0, 20).map(p => p.name),
        topics: analysis.topics.slice(0, 20).map(t => t.phrase),
        personalities: analysis.personalities.slice(0, 20).map(p => p.name),
        companies: analysis.companies.slice(0, 20).map(c => c.name),
        recommendedEngine: {
          industry: engineSelection.recommendedIndustry,
          displayName: engineSelection.engineDisplayName,
          confidence: engineSelection.confidence,
          reasoning: engineSelection.reasoning,
          matchedSignals: engineSelection.matchedSignals,
        },
      });
    } catch (error) {
      console.error("Error analyzing identity:", error);
      res.status(500).json({ message: "Failed to analyze professional identity" });
    }
  });

  app.post("/api/ai/select-engine", requireDbUser, aiGenerationRateLimit, async (req: any, res) => {
    try {
      const { selectedIndustry, focusDescription } = req.body;
      
      if (!focusDescription || focusDescription.length < 10) {
        return res.status(400).json({ message: "Please provide a description of at least 10 characters" });
      }
      
      const result = await selectIndustryEngine(selectedIndustry || "Other", focusDescription);
      
      res.json(result);
    } catch (error) {
      console.error("Error selecting engine:", error);
      res.status(500).json({ message: "Failed to select industry engine" });
    }
  });

  app.get("/api/verticals", async (_req, res) => {
    try {
      const verticals = getAvailableVerticals();
      res.json(verticals);
    } catch (error) {
      console.error("Error fetching verticals:", error);
      res.status(500).json({ message: "Failed to fetch verticals" });
    }
  });

  app.post("/api/ai/generate-post", requireDbUser, aiGenerationRateLimit, async (req: any, res) => {
    try {
      const { headline, summary, source, articleUrl, platform, tone } = req.body;
      
      if (!headline || !platform || !tone) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      
      const content = await generatePostContent(
        { headline, summary: summary || "", source: source || "", articleUrl: articleUrl || "" },
        platform as PlatformKey,
        tone
      );
      
      res.json({ content });
    } catch (error) {
      console.error("Error generating post:", error);
      res.status(500).json({ message: "Failed to generate post content" });
    }
  });
}
