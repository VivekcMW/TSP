import type { NextFunction, Request, RequestHandler, Response } from "express";
import { can, requiresAudit, type Actor, type Permission } from "../services/permissions";
import { writeAuditLog } from "../services/tenancy";

/**
 * Permission gate.
 *
 * Mounted after requireDbUser, which supplies req.tenant. Two things are
 * deliberately handled here rather than in handlers:
 *
 *   - Auditing. Privileged and cross-tenant actions write an audit entry from
 *     inside this middleware, so a new endpoint cannot forget to audit itself.
 *   - Justification. Cross-tenant access requires a stated reason, rejected
 *     here rather than trusted to each handler.
 */

/** Header carrying the reason for a cross-tenant action. */
const JUSTIFICATION_HEADER = "x-access-reason";

function actorFrom(req: Request): Actor | null {
  const tenant = req.tenant;
  if (!tenant) return null;
  return {
    // A platform actor is not a member, so no tenant role is claimed for them.
    role: tenant.viaPlatformRole ? null : tenant.role,
    platformRole: tenant.platformRole,
    viaPlatformRole: tenant.viaPlatformRole,
  };
}

export function requirePermission(permission: Permission): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const actor = actorFrom(req);

    if (!actor || !req.dbUser || !req.tenant) {
      // requireDbUser did not run, or ran and failed. Programming error.
      console.error("requirePermission used without requireDbUser", { path: req.path });
      return res.status(500).json({ message: "Authorization not initialised" });
    }

    if (!can(actor, permission)) {
      return res.status(403).json({ message: "Forbidden", code: "permission_denied" });
    }

    const justification = readJustification(req);

    if (actor.viaPlatformRole && !justification) {
      return res.status(400).json({
        message: `Cross-tenant access requires a reason in the ${JUSTIFICATION_HEADER} header.`,
        code: "justification_required",
      });
    }

    if (requiresAudit(actor, permission)) {
      // Awaited so an action is never recorded as having happened before the
      // audit entry exists. Privileged actions fail closed if auditing fails.
      const auditWritten = await writeAuditLog({
        actorUserId: req.dbUser.id,
        actorPlatformRole: actor.platformRole,
        tenantId: req.tenant.tenantId,
        action: permission,
        resourceType: req.method,
        resourceId: req.originalUrl,
        justification: justification ?? null,
        correlationId: correlationId(req),
        metadata: { viaPlatformRole: actor.viaPlatformRole },
      });
      if (!auditWritten) return res.status(503).json({ message: "Audit service unavailable", code: "audit_unavailable" });
    }

    next();
  };
}

function readJustification(req: Request): string | undefined {
  const raw = req.headers[JUSTIFICATION_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 500) : undefined;
}

function correlationId(req: Request): string | undefined {
  const raw = req.headers["x-correlation-id"] ?? req.headers["x-request-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || undefined;
}
