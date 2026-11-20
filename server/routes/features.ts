import type { Express } from "express";
import { CLIENT_FEATURE_FLAGS, type ClientFeatureName } from "@shared/client-features";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { isFeatureEnabled } from "../services/featureFlags";

/** Evaluated for the caller's tenant. Lookup failures keep the existing experience rather than failing the app. */
export function registerFeatureRoutes(app: Express) {
  app.get("/api/features", requireDbUser, async (req, res) => {
    const { tenant } = authedOf(req);
    const entries = await Promise.all((Object.entries(CLIENT_FEATURE_FLAGS) as Array<[ClientFeatureName, string]>).map(async ([name, key]) => {
      try {
        return [name, await isFeatureEnabled(key, false, tenant.tenantId)] as const;
      } catch {
        console.error(`[features] Could not evaluate ${key}; using the existing experience`);
        return [name, false] as const;
      }
    }));
    res.set("Cache-Control", "no-store").json(Object.fromEntries(entries));
  });
}
