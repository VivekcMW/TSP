import type { Express } from "express";
import { db } from "../db";
import { toSafeUser } from "../lib/sanitize";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { sendAppEmail } from "../services/email";
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
        const welcomeSubject = industry ? `Welcome to TheSocialPundit · ${industry.replaceAll("_", " ")}` : "Welcome to TheSocialPundit";
        sendAppEmail({ type: "welcome", recipient: updatedUser.email, recipientName: firstName, userId: updatedUser.id, subject: welcomeSubject, html: `<p>Your personalized workspace is ready.</p><p>Start with your curated inbox and create your first draft.</p>`, required: false, dedupeKey: `welcome:${updatedUser.id}` }).catch((err) => console.error("Failed to send welcome email:", err));
      }
      
      res.json(toSafeUser(updatedUser));
    } catch (error) {
      console.error("Error completing registration:", error);
      res.status(500).json({ message: "Failed to complete registration" });
    }
  });
}
