import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { emailPreferences } from "@shared/schema";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";

export function registerEmailPreferenceRoutes(app: Express) {
  app.get("/api/email-preferences", requireDbUser, requirePermission("profile:read:own"), async (req, res) => {
    const userId = authedOf(req).dbUser.id;
    const [preference] = await db.select().from(emailPreferences).where(eq(emailPreferences.userId, userId)).limit(1);
    res.json(preference ?? { userId, marketing: true, productUpdates: true, dailyDigest: true, contentAlerts: true, unsubscribedAt: null });
  });

  app.patch("/api/email-preferences", requireDbUser, requirePermission("profile:write:own"), async (req, res) => {
    const userId = authedOf(req).dbUser.id;
    const allowed = {
      marketing: typeof req.body.marketing === "boolean" ? req.body.marketing : undefined,
      productUpdates: typeof req.body.productUpdates === "boolean" ? req.body.productUpdates : undefined,
      dailyDigest: typeof req.body.dailyDigest === "boolean" ? req.body.dailyDigest : undefined,
      contentAlerts: typeof req.body.contentAlerts === "boolean" ? req.body.contentAlerts : undefined,
    };
    const [existing] = await db.select({ id: emailPreferences.id }).from(emailPreferences).where(eq(emailPreferences.userId, userId)).limit(1);
    let unsubscribedAt: Date | null | undefined;
    if (allowed.marketing === false) unsubscribedAt = new Date();
    if (allowed.marketing === true) unsubscribedAt = null;
    const data = { ...allowed, unsubscribedAt, updatedAt: new Date() };
    const [preference] = existing
      ? await db.update(emailPreferences).set(data).where(eq(emailPreferences.userId, userId)).returning()
      : await db.insert(emailPreferences).values({ userId, marketing: allowed.marketing ?? true, productUpdates: allowed.productUpdates ?? true, dailyDigest: allowed.dailyDigest ?? true, contentAlerts: allowed.contentAlerts ?? true, unsubscribedAt: allowed.marketing === false ? new Date() : null }).returning();
    res.json(preference);
  });
}
