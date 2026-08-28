import type { Express } from "express";
import { db } from "../db";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { engineRegistry } from "../services/engines/index.js";
import { storage } from "../storage";
import { users } from "@shared/models/auth";
import { IndustrySlug } from "@shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const completeOnboardingSchema = z.object({
  focusDescription: z.string().min(10).max(500).optional(),
  publications: z.array(z.string()).max(20).optional(),
  keywords: z.array(z.string()).max(20).optional(),
  influencers: z.array(z.string()).max(20).optional(),
  companies: z.array(z.string()).max(20).optional(),
  recommendedIndustry: z.string().optional(),
});

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
      
      if (!profile) {
        profile = await storage.createUserProfile(scope, {
          onboardingStatus: "pending",
          publications: [],
          keywords: [],
          influencers: [],
          companies: [],
        });
      }
      
      res.json(profile);
    } catch (error) {
      console.error("Error fetching profile:", error);
      res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  app.patch("/api/profile", requireDbUser, requirePermission("profile:write:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const userId = dbUser.id;
      const { focusDescription, publications, keywords, influencers, companies } = req.body;
      
      const existingProfile = await storage.getUserProfile(scope);
      if (!existingProfile) {
        return res.status(404).json({ message: "Profile not found" });
      }
      
      const updateData: any = {};
      if (focusDescription !== undefined) updateData.focusDescription = focusDescription;
      if (publications !== undefined) updateData.publications = publications;
      if (keywords !== undefined) updateData.keywords = keywords;
      if (influencers !== undefined) updateData.influencers = influencers;
      if (companies !== undefined) updateData.companies = companies;
      
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

      if (recommendedIndustry) {
        await db.update(users).set({ industry: recommendedIndustry }).where(eq(users.id, userId));
        console.log(`[Onboarding] Updated user ${userId} industry to: ${recommendedIndustry}`);
      }

      let profile = await storage.getUserProfile(scope);
      
      if (!profile) {
        profile = await storage.createUserProfile(scope, {
          focusDescription,
          onboardingStatus: "completed",
          publications: publications || [],
          keywords: keywords || [],
          influencers: influencers || [],
          companies: companies || [],
        });
      } else {
        profile = await storage.updateUserProfile(scope, {
          focusDescription,
          onboardingStatus: "completed",
          publications: publications || [],
          keywords: keywords || [],
          influencers: influencers || [],
          companies: companies || [],
        });
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
