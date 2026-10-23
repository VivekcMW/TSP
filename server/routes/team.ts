import type { Express } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { tenants, INVITABLE_TENANT_ROLES } from "@shared/models/tenancy";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { requireFeatureEnabled } from "../middlewares/requireFeatureEnabled";
import { listMemberships } from "../services/tenancy";
import { storage, ScheduleConflictError } from "../storage";
import { sendAppEmail } from "../services/email";
import { emailTemplates } from "../services/email/templates";
import {
  acceptTenantInvitation, inviteTenantMember, listPendingInvitations, listTenantMembers,
  removeTenantMember, revokeInvitation, updateTenantMemberRole,
} from "../services/teamInvitations";

const inviteSchema = z.object({ email: z.string().trim().toLowerCase().max(254).email(), role: z.enum(INVITABLE_TENANT_ROLES) }).strict();
const roleSchema = z.object({ role: z.enum(INVITABLE_TENANT_ROLES) }).strict();
const acceptSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const approveSchema = z.object({ content: z.string().min(1).max(5000), updatedAt: z.string().datetime() }).strict();

function acceptUrl(invitationToken: string): string {
  const origin = process.env.APP_URL ?? "https://www.thesocialpundit.com";
  return `${origin}/dashboard/accept-invite?token=${invitationToken}`;
}

/** Toggled from Admin > Feature Flags (key: team_workspaces). Context/role lookup stays
 * available even when disabled — only team management/collaboration actions are gated. */
const teamFeature = requireFeatureEnabled("team_workspaces");

export function registerTeamRoutes(app: Express) {
  app.get("/api/team/context", requireDbUser, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const { dbUser, tenant } = authedOf(req);
      const [row] = await db.select({ name: tenants.name, kind: tenants.kind }).from(tenants).where(eq(tenants.id, tenant.tenantId)).limit(1);
      const memberships = await listMemberships(dbUser.id);
      res.json({ tenantId: tenant.tenantId, tenantName: row?.name ?? "Workspace", tenantKind: row?.kind ?? "personal", role: tenant.role, memberships });
    } catch {
      console.error("Error fetching team context");
      res.status(500).json({ message: "Failed to fetch team context" });
    }
  });

  app.get("/api/team/members", requireDbUser, teamFeature, requirePermission("member:read:tenant"), async (req, res) => {
    try {
      res.json(await listTenantMembers(authedOf(req).tenant.tenantId));
    } catch {
      console.error("Error listing team members");
      res.status(500).json({ message: "Failed to list team members" });
    }
  });

  app.get("/api/team/invitations", requireDbUser, teamFeature, requirePermission("member:read:tenant"), async (req, res) => {
    try {
      res.json(await listPendingInvitations(authedOf(req).tenant.tenantId));
    } catch {
      console.error("Error listing pending invitations");
      res.status(500).json({ message: "Failed to list pending invitations" });
    }
  });

  app.post("/api/team/invitations", requireDbUser, teamFeature, requirePermission("member:invite:tenant"), async (req, res) => {
    const validation = inviteSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ message: "Enter a valid email and role." });
    try {
      const { dbUser, tenant } = authedOf(req);
      const result = await inviteTenantMember({ tenantId: tenant.tenantId, email: validation.data.email, role: validation.data.role, invitedByUserId: dbUser.id });
      if (result.kind === "already_member") return res.status(409).json({ message: "This person is already a member of this workspace." });
      if (result.kind === "already_invited") return res.status(409).json({ message: "An invitation is already pending for this email." });
      const [row] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenant.tenantId)).limit(1);
      await sendAppEmail({
        type: "team_invitation", recipient: validation.data.email, dedupeKey: `team-invitation:${result.id}`,
        ...emailTemplates.teamInvitation({ inviterName: dbUser.name || dbUser.firstName || "A teammate", tenantName: row?.name ?? "a workspace", role: validation.data.role, acceptUrl: acceptUrl(result.token) }),
      });
      res.status(201).json({ id: result.id, email: validation.data.email, role: validation.data.role });
    } catch {
      console.error("Error inviting team member");
      res.status(500).json({ message: "Failed to send invitation" });
    }
  });

  app.delete("/api/team/invitations/:id", requireDbUser, teamFeature, requirePermission("member:invite:tenant"), async (req, res) => {
    try {
      const revoked = await revokeInvitation(authedOf(req).tenant.tenantId, req.params.id);
      if (!revoked) return res.status(404).json({ message: "Invitation not found" });
      res.json({ success: true });
    } catch {
      console.error("Error revoking invitation");
      res.status(500).json({ message: "Failed to revoke invitation" });
    }
  });

  app.patch("/api/team/members/:userId", requireDbUser, teamFeature, requirePermission("member:invite:tenant"), async (req, res) => {
    const validation = roleSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ message: "Choose a valid role." });
    try {
      const result = await updateTenantMemberRole(authedOf(req).tenant.tenantId, req.params.userId, validation.data.role);
      if (result.kind === "not_found") return res.status(404).json({ message: "Member not found" });
      if (result.kind === "owner_immutable") return res.status(409).json({ message: "The workspace owner's role cannot be changed." });
      res.json({ success: true });
    } catch {
      console.error("Error updating member role");
      res.status(500).json({ message: "Failed to update member role" });
    }
  });

  app.delete("/api/team/members/:userId", requireDbUser, teamFeature, requirePermission("member:remove:tenant"), async (req, res) => {
    try {
      const result = await removeTenantMember(authedOf(req).tenant.tenantId, req.params.userId);
      if (result.kind === "not_found") return res.status(404).json({ message: "Member not found" });
      if (result.kind === "owner_immutable") return res.status(409).json({ message: "The workspace owner cannot be removed." });
      res.json({ success: true });
    } catch {
      console.error("Error removing team member");
      res.status(500).json({ message: "Failed to remove team member" });
    }
  });

  // Not gated by a tenant permission: the accepting user is not yet a member.
  app.post("/api/team-invitations/accept", requireDbUser, teamFeature, async (req, res) => {
    const validation = acceptSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ message: "This invitation link is invalid." });
    try {
      const { dbUser } = authedOf(req);
      const result = await acceptTenantInvitation({ userId: dbUser.id, userEmail: dbUser.email, token: validation.data.token });
      if (result.kind === "invalid") return res.status(404).json({ message: "This invitation is invalid or has expired." });
      if (result.kind === "email_mismatch") return res.status(403).json({ message: "This invitation was sent to a different email address. Sign in with that address to accept it." });
      if (result.kind === "already_member") return res.status(200).json({ status: "already_member" });
      res.status(200).json({ status: "accepted", tenantId: result.tenantId, role: result.role });
    } catch {
      console.error("Error accepting team invitation");
      res.status(500).json({ message: "Failed to accept invitation" });
    }
  });

  app.get("/api/team/review-queue", requireDbUser, teamFeature, requirePermission("draft:read:tenant"), async (req, res) => {
    try {
      res.json(await storage.getDraftsPendingTenantReview(authedOf(req).tenant));
    } catch {
      console.error("Error fetching team review queue");
      res.status(500).json({ message: "Failed to fetch review queue" });
    }
  });

  app.post("/api/team/drafts/:id/approve", requireDbUser, teamFeature, requirePermission("draft:approve:tenant"), async (req, res) => {
    const validation = approveSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ message: "Supply the exact reviewed draft and revision." });
    try {
      const draft = await storage.approveDraftForTenantReview(authedOf(req).tenant, req.params.id, validation.data.content, validation.data.updatedAt);
      if (!draft) return res.status(404).json({ message: "Draft not found" });
      res.json(draft);
    } catch (error) {
      console.error("Error approving teammate draft");
      res.status(error instanceof ScheduleConflictError ? 409 : 500).json({ message: error instanceof Error ? error.message : "Could not record approval" });
    }
  });
}
