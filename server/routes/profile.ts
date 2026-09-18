import type { Express } from "express";
import { db } from "../db";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { engineRegistry } from "../services/engines/index.js";
import { normalizeKeywords } from "../services/punditBrain.js";
import { storage } from "../storage";
import { users } from "@shared/models/auth";
import { ALL_PLATFORM_KEYS, IndustrySlug, platformIntegrations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { filterEnabledPlatforms } from "../lib/platformAvailability";

const completeOnboardingSchema = z.object({
  focusDescription: z.string().min(10).max(500).optional(),
  publications: z.array(z.string()).max(20).optional(),
  keywords: z.array(z.string()).max(20).optional(),
  influencers: z.array(z.string()).max(20).optional(),
  companies: z.array(z.string()).max(20).optional(),
  recommendedIndustry: z.string().optional(),
});

const profileListSchema = z.array(z.string().trim().min(1).max(100)).max(20);
const weightedKeywordSchema = z.array(
  z.object({
    keyword: z.string().trim().min(1).max(100),
    weight: z.number().min(0).max(1).optional(),
  })
).max(20);

function validateProfileList(value: unknown, field: string): { values?: string[]; error?: string } {
  // Special handling for keywords: accept both old string format and new weighted format
  if (field === "keywords") {
    // Try weighted format first
    const weightedValidation = weightedKeywordSchema.safeParse(value);
    if (weightedValidation.success) {
      const keywords = weightedValidation.data.map((item) => item.keyword);
      const unique = Array.from(new Map(keywords.map((item) => [item.toLocaleLowerCase(), item])).values());
      return { values: unique };
    }
    // Fall back to string format for backward compatibility
    const stringValidation = profileListSchema.safeParse(value);
    if (stringValidation.success) {
      const values = Array.from(new Map(stringValidation.data.map((item) => [item.toLocaleLowerCase(), item])).values());
      return { values };
    }
    return { error: `Invalid ${field}. Select up to 20 non-empty values.` };
  }

  // For other fields, use the original string format validation
  const validation = profileListSchema.safeParse(value);
  if (!validation.success) return { error: `Invalid ${field}. Select up to 20 non-empty values.` };

  const values = Array.from(new Map(validation.data.map((item) => [item.toLocaleLowerCase(), item])).values());
  return { values };
}

function validateProfilePatch(body: any) {
  const { enabledPlatforms, defaultPlatform, defaultTone, preferredPublishTime } = body;
  if (enabledPlatforms !== undefined && !z.array(z.enum(ALL_PLATFORM_KEYS)).safeParse(enabledPlatforms).success) {
    return { error: "Invalid enabledPlatforms" };
  }
  if (defaultPlatform !== undefined && !ALL_PLATFORM_KEYS.includes(defaultPlatform)) return { error: "Invalid defaultPlatform" };
  if (defaultTone !== undefined && !["professional", "authoritative", "contrarian", "ai-recommended"].includes(defaultTone)) return { error: "Invalid defaultTone" };
  if (preferredPublishTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(preferredPublishTime)) return { error: "Invalid preferredPublishTime" };

  const normalizedLists: Record<string, string[]> = {};
  for (const field of ["publications", "keywords", "influencers", "companies"]) {
    if (body[field] === undefined) continue;
    const result = validateProfileList(body[field], field);
    if (result.error) return { error: result.error };
    normalizedLists[field] = result.values ?? [];
  }
  return { normalizedLists };
}

function buildProfileUpdateData(body: any, normalizedLists: Record<string, string[]>, disabledPlatforms: Set<string>) {
  const updateData: Record<string, unknown> = Object.fromEntries(
    Object.entries(body).filter(([field, value]) =>
      ["focusDescription", "timezone", "defaultPlatform", "defaultTone", "preferredPublishTime"].includes(field) && value !== undefined,
    ),
  );
  for (const field of ["publications", "keywords", "influencers", "companies"]) {
    if (normalizedLists[field]) updateData[field] = normalizedLists[field];
  }
  if (body.enabledPlatforms !== undefined) updateData.enabledPlatforms = filterEnabledPlatforms(body.enabledPlatforms, disabledPlatforms);
  if (typeof body.requirePublishReview === "boolean") updateData.requirePublishReview = body.requirePublishReview;
  if (typeof body.autoPublish === "boolean") updateData.autoPublish = body.autoPublish;
  if (typeof body.dailyDigest === "boolean") updateData.dailyDigest = body.dailyDigest;
  if (typeof body.contentAlerts === "boolean") updateData.contentAlerts = body.contentAlerts;
  if (typeof body.productUpdates === "boolean") updateData.productUpdates = body.productUpdates;
  return updateData;
}

// Helper to sanitize onboarding data - truncates strings and arrays to prevent validation errors
function sanitizeOnboardingData(data: any) {
  return {
    ...data,
    focusDescription: data.focusDescription?.slice(0, 500),
    publications: data.publications?.slice(0, 20),
    keywords: data.keywords?.slice(0, 20),
    influencers: data.influencers?.slice(0, 20),
    companies: data.companies?.slice(0, 20),
  };
}

export function registerProfileRoutes(app: Express) {
  app.get("/api/profile", requireDbUser, requirePermission("profile:read:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const userId = dbUser.id;
      
      if (!userId) {
        console.error("No user ID found in request");
        return res.status(401).json({ message: "User not authenticated" });
      }
      
      let profile = await storage.getUserProfile(scope);

      profile ??= await storage.createUserProfile(scope, {
          onboardingStatus: "pending",
          publications: [],
          keywords: [],
          influencers: [],
          companies: [],
          });

      const disabledPlatforms = new Set(
        (await db.select({ key: platformIntegrations.key }).from(platformIntegrations).where(eq(platformIntegrations.enabled, false)))
          .map((row) => row.key),
      );
      const safeEnabledPlatforms = filterEnabledPlatforms(profile.enabledPlatforms, disabledPlatforms);

      if (safeEnabledPlatforms.length !== (profile.enabledPlatforms ?? []).length) {
        profile = await storage.updateUserProfile(scope, { enabledPlatforms: safeEnabledPlatforms });
      }

      res.json({ ...profile, enabledPlatforms: safeEnabledPlatforms });
    } catch (error) {
      console.error("Error fetching profile:", error);
      res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  app.patch("/api/profile", requireDbUser, requirePermission("profile:write:own"), async (req, res) => {
    try {
      const { tenant: scope } = authedOf(req);
      const validation = validateProfilePatch(req.body);
      if (validation.error) return res.status(400).json({ message: validation.error });

      const existingProfile = await storage.getUserProfile(scope);
      if (!existingProfile) {
        return res.status(404).json({ message: "Profile not found" });
      }

      const disabledPlatforms = new Set(
        (await db.select({ key: platformIntegrations.key }).from(platformIntegrations).where(eq(platformIntegrations.enabled, false)))
          .map((row) => row.key),
      );

      const updateData = buildProfileUpdateData(req.body, validation.normalizedLists ?? {}, disabledPlatforms);

      const profile = await storage.updateUserProfile(scope, updateData);

      res.json(profile);
    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  app.post("/api/profile/complete-onboarding", requireDbUser, requirePermission("profile:write:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const userId = dbUser.id;
      // Sanitize data before validation to prevent truncation errors
      const sanitizedBody = sanitizeOnboardingData(req.body);
      
      const validation = completeOnboardingSchema.safeParse(sanitizedBody);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid request data", errors: validation.error.errors });
      }
      
      const { focusDescription, publications, keywords, influencers, companies, recommendedIndustry } = validation.data;

      // Normalize keywords to weighted format
      const normalizedKeywords = normalizeKeywords(keywords || []);

      if (recommendedIndustry) {
        await db.update(users).set({ industry: recommendedIndustry }).where(eq(users.id, userId));
        console.log(`[Onboarding] Updated user ${userId} industry to: ${recommendedIndustry}`);
      }

      let profile = await storage.getUserProfile(scope);
      
      const profileData = {
        focusDescription,
        onboardingStatus: "completed" as const,
        publications: publications || [],
        keywords: normalizedKeywords,
        influencers: influencers || [],
        companies: companies || [],
        recommendedIndustry: recommendedIndustry || undefined,
      };

      if (!profile) {
        profile = await storage.createUserProfile(scope, profileData);
      } else {
        profile = await storage.updateUserProfile(scope, profileData);
      }

      const industryToUse = (recommendedIndustry || "other") as IndustrySlug;
      const engine = engineRegistry.getEngine(industryToUse);
      
      res.json({
        ...profile,
        assignedEngine: {
          industry: industryToUse,
          displayName: engine.config.displayName,
        },
      });
    } catch (error) {
      console.error("Error completing onboarding:", error);
      res.status(500).json({ message: "Failed to complete onboarding" });
    }
  });
}
