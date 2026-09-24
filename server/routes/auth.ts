import type { Express } from "express";
import { db } from "../db";
import { toSafeUser } from "../lib/sanitize";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { emailTemplates, sendAppEmail } from "../services/email";
import { industryDisplayName } from "../services/metaEngine";
import { users } from "@shared/models/auth";
import { eq } from "drizzle-orm";
import { z } from "zod";

const completeRegistrationSchema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  countries: z.array(z.string().min(1).max(100)).min(1).max(10),
  industries: z.array(z.string().min(1).max(100)).min(1).max(10),
});

export function registerAuthRoutes(app: Express) {
  app.get("/api/auth-providers", (_req, res) => {
    res.json({
      google: Boolean(process.env.GOOGLE_AUTH_CLIENT_ID && process.env.GOOGLE_AUTH_CLIENT_SECRET),
      linkedin: Boolean(process.env.LINKEDIN_AUTH_CLIENT_ID && process.env.LINKEDIN_AUTH_CLIENT_SECRET),
      twitter: Boolean(process.env.TWITTER_AUTH_CLIENT_ID && process.env.TWITTER_AUTH_CLIENT_SECRET),
    });
  });

  app.get("/api/me", requireDbUser, (req, res) => {
    res.json(toSafeUser(authedOf(req).dbUser));
  });

  app.post("/api/complete-registration", requireDbUser, async (req, res) => {
    try {
      const { dbUser } = authedOf(req);
      const userId = dbUser.id;

      const validation = completeRegistrationSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid request data", errors: validation.error.errors });
      }
      
      const { firstName, lastName, countries, industries } = validation.data;
      // Existing curation engines use one primary context. Preserve it while
      // retaining every selection for future multi-industry ranking.
      const [country] = countries;
      const [industry] = industries;
      
      // First check if user exists
      const [existingUser] = await db.select().from(users).where(eq(users.id, userId));
      
      if (!existingUser) {
        console.error("User not found for complete-registration:", userId);
        return res.status(404).json({ message: "User account not found. Please register again." });
      }
      
      const [updatedUser] = await db
        .update(users)
        .set({
          firstName,
          lastName,
          country,
          industry,
          countries,
          industries,
          registrationCompleted: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();
      
      // Send industry-customized welcome email
      if (updatedUser?.email) {
        sendAppEmail({ type: "welcome", recipient: updatedUser.email, recipientName: firstName, userId: updatedUser.id, ...emailTemplates.welcome(industryDisplayName(industry)), dedupeKey: `welcome:${updatedUser.id}` }).catch((err) => console.error("Failed to send welcome email:", err));
      }
      
      res.json(toSafeUser(updatedUser));
    } catch (error) {
      console.error("Error completing registration:", error);
      res.status(500).json({ message: "Failed to complete registration" });
    }
  });

  // Endpoint to update user name (accepts full name and parses into firstName/lastName)
  // NOTE: This must use /api/account namespace, NOT /api/auth, because Better Auth
  // intercepts all /api/auth/* routes and returns 404 for unrecognized endpoints.
  async function handleUpdateName(req: any, res: any) {
    try {
      const { fullName } = req.body;
      if (!req.dbUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const userId = req.dbUser.id;

      // Validate input
      if (typeof fullName !== "string") {
        return res.status(400).json({ message: "fullName must be a string" });
      }

      const trimmedName = fullName.trim();
      if (!trimmedName) {
        return res.status(400).json({ message: "Name cannot be empty" });
      }

      // Parse full name into firstName and lastName
      // Split on first space: everything before is firstName, everything after is lastName
      const parts = trimmedName.split(/\s+/);
      const firstName = parts[0];
      const lastName = parts.slice(1).join(" ") || null;

      // Update the user record with parsed firstName/lastName and full name
      const updatedUser = await db
        .update(users)
        .set({
          firstName,
          lastName,
          name: trimmedName,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();

      res.json(toSafeUser(updatedUser[0]));
    } catch (error) {
      console.error("Error updating name:", error);
      res.status(500).json({ message: "Failed to update name" });
    }
  }

  // Use /api/account namespace since /api/auth/* is intercepted by Better Auth
  // and returns 404 for unrecognized endpoints
  app.post("/api/account/update-name", requireDbUser, handleUpdateName);
}
