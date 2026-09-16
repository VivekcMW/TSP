import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { aiGenerationRateLimit } from "../middlewares/rateLimit";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { getAvailableVerticals, normalizeIndustryToSlug, selectIndustryEngine } from "../services/metaEngine";
import { analyzeProfessionalIdentity, generatePostContentDetailed, generatePostSchema, onboardingIdentitySchema } from "../services/punditBrain";
import { getAIErrorResponse } from "../services/openRouter";
import { platformIntegrations } from "@shared/schema";
import { z } from "zod";
import { fetchArticleFromUrl } from "../services/urlFetcher";
import { CrawlError } from "../services/crawlerFetch";
import { editorialCancellation, editorialContext, editorialPreferences, validateEditorialFormat } from "./editorial-context";

const detailedPostSchema = generatePostSchema.extend({
  ...editorialPreferences,
  fetchSource: z.boolean().default(false),
  summary: z.string().max(50_000),
}).refine(value => value.fetchSource ? Boolean(value.articleUrl) : Boolean(value.summary.trim()), {
  message: "Supply source text or request fetching from an article URL",
});

export function registerAiRoutes(app: Express) {
  app.post("/api/ai/analyze-identity", requireDbUser, requirePermission("generation:create:own"), aiGenerationRateLimit, async (req, res) => {
    try {
      const validation = onboardingIdentitySchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ code: "ai_invalid_input", message: "Provide a description of 10–500 characters and, if supplied, an industry of 1–100 characters.", errors: validation.error.flatten().fieldErrors });
      }
      const { focusDescription, selectedIndustry } = validation.data;
      
      const industrySlug = normalizeIndustryToSlug(selectedIndustry);
      const scope = authedOf(req).tenant;
      const [analysis, engineSelection] = await Promise.all([
        analyzeProfessionalIdentity(focusDescription, industrySlug, scope),
        selectIndustryEngine(selectedIndustry, focusDescription, scope),
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
      const failure = getAIErrorResponse(error);
      console.error("Error analyzing identity:", failure.body.code);
      if (failure.retryAfterSeconds) res.setHeader("Retry-After", failure.retryAfterSeconds);
      res.status(failure.status).json(failure.body);
    }
  });

  app.post("/api/ai/select-engine", requireDbUser, requirePermission("generation:create:own"), aiGenerationRateLimit, async (req, res) => {
    try {
      const validation = onboardingIdentitySchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ code: "ai_invalid_input", message: "Provide a description of 10–500 characters and, if supplied, an industry of 1–100 characters.", errors: validation.error.flatten().fieldErrors });
      }
      const { selectedIndustry, focusDescription } = validation.data;

      const result = await selectIndustryEngine(selectedIndustry, focusDescription, authedOf(req).tenant);
      
      res.json(result);
    } catch (error) {
      const failure = getAIErrorResponse(error);
      console.error("Error selecting engine:", failure.body.code);
      if (failure.retryAfterSeconds) res.setHeader("Retry-After", failure.retryAfterSeconds);
      res.status(failure.status).json(failure.body);
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

  app.post("/api/ai/generate-post", requireDbUser, requirePermission("generation:create:own"), aiGenerationRateLimit, async (req, res) => {
    const cancellation = editorialCancellation(req, res);
    try {
      const validation = detailedPostSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ code: "ai_invalid_input", message: "Invalid post generation input. Supply article content, source, platform, and tone within the allowed limits.", errors: validation.error.flatten().fieldErrors });
      }
      const { headline, summary, source, articleUrl, platform, tone, userContext, format, fetchSource } = validation.data;
      validateEditorialFormat([platform], format);

      const [integration] = await db
        .select({ enabled: platformIntegrations.enabled })
        .from(platformIntegrations)
        .where(eq(platformIntegrations.key, platform));

      if (integration && !integration.enabled) {
        return res.status(403).json({ message: "This platform is temporarily unavailable. Please try again later." });
      }

      const options = await editorialContext(req, { format, userContext }, cancellation.signal);
      const fetched = fetchSource ? await fetchArticleFromUrl(articleUrl!, cancellation.signal) : undefined;
      const article = fetched ? { headline: fetched.title, summary: fetched.content, source: fetched.source, articleUrl: fetched.url, contentMetadata: fetched.contentMetadata } : { headline, summary, source, articleUrl };
      const result = await generatePostContentDetailed(
        article,
        platform,
        tone,
        options,
      );

      res.json({ ...result, article, format });
    } catch (error) {
      if (error instanceof CrawlError) return res.status(422).json({ code: "source_unreadable", message: `${error.message} Try another public article or use Write article in Instant Review.` });
      const failure = getAIErrorResponse(error);
      console.error("Error generating post:", failure.body.code);
      if (failure.retryAfterSeconds) res.setHeader("Retry-After", failure.retryAfterSeconds);
      res.status(failure.status).json(failure.body);
    } finally {
      cancellation.dispose();
    }
  });
}
