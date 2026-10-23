import type { NextFunction, Request, RequestHandler, Response } from "express";
import { isFeatureEnabled } from "../services/featureFlags";

/**
 * Operator kill-switch for an already-shipped feature, backed by the
 * `feature_flags` admin table. Mounted after requireDbUser, same position as
 * requirePermission. A missing flag row defaults to enabled (see
 * isFeatureEnabled) — this exists to let an operator turn a feature OFF
 * without a deploy, not to gate a feature behind an opt-in launch toggle.
 */
export function requireFeatureEnabled(key: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    let enabled: boolean;
    try { enabled = req.tenant ? await isFeatureEnabled(key, true, req.tenant.tenantId) : await isFeatureEnabled(key); }
    catch { console.error("[feature-flags] Policy unavailable"); return res.status(503).json({ message: "Feature policy unavailable", code: "feature_policy_unavailable" }); }
    if (!enabled) {
      return res.status(503).json({ message: "This feature is temporarily unavailable.", code: "feature_disabled" });
    }
    next();
  };
}
