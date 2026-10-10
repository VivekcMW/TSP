import type { RequestHandler } from "express";
import { assertTenantEntitlement, EntitlementError, type TenantCapability } from "../services/entitlements";

/** Mount AFTER requireDbUser/permission checks. Never accepts a tenant from body/query. */
export function requireEntitlement(capability: Exclude<TenantCapability, "generate">): RequestHandler {
  return (req, res, next) => {
    if (!req.dbUser || !req.tenant?.tenantId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    assertTenantEntitlement(req.tenant.tenantId, capability).then(() => next()).catch(error => {
      if (error instanceof EntitlementError) {
        res.status(error.statusCode).json({ code: error.code, message: error.message });
        return;
      }
      res.status(503).json({ code: "entitlements_unavailable", message: "Could not verify plan access" });
    });
  };
}