import { randomBytes, createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { users } from "@shared/models/auth";
import { tenantMembers, tenantInvitations, type InvitableTenantRole, type TenantRole } from "@shared/models/tenancy";

/**
 * Team workspace membership: inviting a collaborator into an EXISTING tenant
 * with a role. Distinct from the unrelated friend_invitations growth feature,
 * which only ever creates brand new, separate accounts.
 *
 * Deliberately uses plain `db`, not the tenant-scoped `scoped()` wrapper in
 * storage.ts: tenant_members/tenant_invitations have no RLS (same precedent as
 * server/services/tenancy.ts itself), and accepting an invitation must resolve
 * it by token before the accepting user has any membership — and therefore no
 * app.tenant_id — for that tenant. Callers (the route layer) are responsible
 * for checking the caller's own tenant/role via requirePermission first.
 */

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizeEmail = (value: string) => value.trim().toLowerCase();

export interface TeamMemberView { userId: string; name: string; email: string; role: TenantRole; joinedAt: Date }
export interface PendingInvitationView { id: string; email: string; role: InvitableTenantRole; invitedAt: Date; expiresAt: Date }

export async function listTenantMembers(tenantId: string): Promise<TeamMemberView[]> {
  const rows = await db.select({ userId: tenantMembers.userId, name: users.name, email: users.email, role: tenantMembers.role, joinedAt: tenantMembers.createdAt })
    .from(tenantMembers).innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(eq(tenantMembers.tenantId, tenantId)).orderBy(tenantMembers.createdAt);
  return rows.map(row => ({ ...row, role: row.role as TenantRole }));
}

export async function listPendingInvitations(tenantId: string): Promise<PendingInvitationView[]> {
  const rows = await db.select({ id: tenantInvitations.id, email: tenantInvitations.invitedEmail, role: tenantInvitations.role, invitedAt: tenantInvitations.createdAt, expiresAt: tenantInvitations.expiresAt })
    .from(tenantInvitations)
    .where(and(eq(tenantInvitations.tenantId, tenantId), eq(tenantInvitations.status, "pending")))
    .orderBy(tenantInvitations.createdAt);
  return rows.map(row => ({ ...row, role: row.role as InvitableTenantRole }));
}

export type InviteTenantMemberResult = { kind: "invited"; id: string; token: string } | { kind: "already_member" } | { kind: "already_invited" };

export async function inviteTenantMember(params: { tenantId: string; email: string; role: InvitableTenantRole; invitedByUserId: string }): Promise<InviteTenantMemberResult> {
  const email = normalizeEmail(params.email);
  const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existingUser) {
    const [member] = await db.select({ userId: tenantMembers.userId }).from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, params.tenantId), eq(tenantMembers.userId, existingUser.id))).limit(1);
    if (member) return { kind: "already_member" };
  }
  const [pending] = await db.select({ id: tenantInvitations.id }).from(tenantInvitations)
    .where(and(eq(tenantInvitations.tenantId, params.tenantId), eq(tenantInvitations.invitedEmail, email), eq(tenantInvitations.status, "pending"))).limit(1);
  if (pending) return { kind: "already_invited" };
  const token = randomBytes(32).toString("hex");
  const [row] = await db.insert(tenantInvitations).values({
    tenantId: params.tenantId, invitedEmail: email, role: params.role, invitedByUserId: params.invitedByUserId,
    tokenHash: digest(token), expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
  }).returning();
  return { kind: "invited", id: row.id, token };
}

export async function revokeInvitation(tenantId: string, invitationId: string): Promise<boolean> {
  const result = await db.update(tenantInvitations).set({ status: "revoked" })
    .where(and(eq(tenantInvitations.id, invitationId), eq(tenantInvitations.tenantId, tenantId), eq(tenantInvitations.status, "pending")))
    .returning({ id: tenantInvitations.id });
  return result.length > 0;
}

export type AcceptInvitationResult = { kind: "accepted"; tenantId: string; role: TenantRole } | { kind: "invalid" } | { kind: "email_mismatch" } | { kind: "already_member" };

/** One global lock, like friend_invitations/invitations-store.ts: acceptance
 * races (double-click, retry) must never create two memberships. */
export async function acceptTenantInvitation(params: { userId: string; userEmail: string; token: string }): Promise<AcceptInvitationResult> {
  const tokenHash = digest(params.token);
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('tsp:tenant-invitation:v1', 0))`);
    const [invitation] = await tx.select().from(tenantInvitations)
      .where(and(eq(tenantInvitations.tokenHash, tokenHash), eq(tenantInvitations.status, "pending"))).limit(1);
    if (!invitation || invitation.expiresAt.getTime() <= Date.now()) return { kind: "invalid" };
    if (invitation.invitedEmail !== normalizeEmail(params.userEmail)) return { kind: "email_mismatch" };
    const [existingMember] = await tx.select({ userId: tenantMembers.userId }).from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, invitation.tenantId), eq(tenantMembers.userId, params.userId))).limit(1);
    if (existingMember) {
      await tx.update(tenantInvitations).set({ status: "accepted", acceptedByUserId: params.userId, acceptedAt: new Date() }).where(eq(tenantInvitations.id, invitation.id));
      return { kind: "already_member" };
    }
    await tx.insert(tenantMembers).values({ tenantId: invitation.tenantId, userId: params.userId, role: invitation.role });
    await tx.update(tenantInvitations).set({ status: "accepted", acceptedByUserId: params.userId, acceptedAt: new Date() }).where(eq(tenantInvitations.id, invitation.id));
    return { kind: "accepted", tenantId: invitation.tenantId, role: invitation.role as TenantRole };
  });
}

export type UpdateMemberRoleResult = { kind: "updated" } | { kind: "not_found" } | { kind: "owner_immutable" };

export async function updateTenantMemberRole(tenantId: string, targetUserId: string, role: InvitableTenantRole): Promise<UpdateMemberRoleResult> {
  const [existing] = await db.select({ role: tenantMembers.role }).from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, targetUserId))).limit(1);
  if (!existing) return { kind: "not_found" };
  if (existing.role === "owner") return { kind: "owner_immutable" };
  await db.update(tenantMembers).set({ role, updatedAt: new Date() })
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, targetUserId)));
  return { kind: "updated" };
}

export type RemoveMemberResult = { kind: "removed" } | { kind: "not_found" } | { kind: "owner_immutable" };

export async function removeTenantMember(tenantId: string, targetUserId: string): Promise<RemoveMemberResult> {
  const [existing] = await db.select({ role: tenantMembers.role }).from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, targetUserId))).limit(1);
  if (!existing) return { kind: "not_found" };
  if (existing.role === "owner") return { kind: "owner_immutable" };
  await db.delete(tenantMembers).where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, targetUserId)));
  return { kind: "removed" };
}
