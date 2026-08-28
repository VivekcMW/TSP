import type { Express } from "express";
import { db } from "../db";
import { toSafeUser } from "../lib/sanitize";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { sendWelcomeEmail } from "../services/emailService";
import { users } from "@shared/models/auth";
import { eq } from "drizzle-orm";
import { z } from "zod";

const completeRegistrationSchema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  country: z.string().min(1).max(100),
  industry: z.string().min(1).max(100),
});

export function registerAuthRoutes(app: Express) {
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
      
      const { firstName, lastName, country, industry } = validation.data;
      
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
          registrationCompleted: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();
      
      // Send industry-customized welcome email
      if (updatedUser?.email) {
        sendWelcomeEmail(updatedUser.email, firstName, industry).catch((err) => {
          console.error("Failed to send welcome email:", err);
        });
      }
      
      res.json(toSafeUser(updatedUser));
    } catch (error) {
      console.error("Error completing registration:", error);
      res.status(500).json({ message: "Failed to complete registration" });
    }
  });
}
