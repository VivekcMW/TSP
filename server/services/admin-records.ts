import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "../db";
import { users, tenants, tenantMembers, auditLog, emailDeliveries, emailPreferences } from "@shared/schema";
import { effectivePlatformRole } from "@shared/admin-access";
import type { AdminRecordsQuery, AdminUserRecord, AdminAuditRecord, AdminRecordPage, AdminUserOverview, EmailDirectoryQuery, AdminEmailRecord } from "@shared/admin";

const userFields = { id: users.id, name: users.name, email: users.email, emailVerified: users.emailVerified,
  platformRole: users.platformRole, registrationCompleted: users.registrationCompleted, createdAt: users.createdAt };
const auditFields = { id: auditLog.id, actorUserId: auditLog.actorUserId, actorPlatformRole: auditLog.actorPlatformRole,
  tenantId: auditLog.tenantId, action: auditLog.action, resourceType: auditLog.resourceType, resourceId: auditLog.resourceId,
  justification: auditLog.justification, correlationId: auditLog.correlationId, createdAt: auditLog.createdAt };
const literal = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;
function safeUser(user: {
  id: string; name: string; email: string; emailVerified: boolean; platformRole: string | null; registrationCompleted: Date | null; createdAt: Date | null;
}): AdminUserRecord {
  return { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified, platformRole: effectivePlatformRole(user),
    registrationCompleted: user.registrationCompleted?.toISOString() ?? null, createdAt: user.createdAt?.toISOString() ?? null };
}
export function userDirectoryFilter(query: AdminRecordsQuery) {
  return query.q ? or(ilike(users.name, literal(query.q)), ilike(users.email, literal(query.q)), eq(users.id, query.q)) : undefined;
}
export function auditDirectoryFilter(query: AdminRecordsQuery) {
  return and(query.q ? or(eq(auditLog.id, query.q), eq(auditLog.correlationId, query.q), ilike(auditLog.resourceId, literal(query.q))) : undefined,
    query.actor ? eq(auditLog.actorUserId, query.actor) : undefined,
    query.tenant ? eq(auditLog.tenantId, query.tenant) : undefined,
    query.action ? eq(auditLog.action, query.action) : undefined);
}
export async function getUserDirectory(query: AdminRecordsQuery): Promise<AdminRecordPage<AdminUserRecord>> {
  const where = userDirectoryFilter(query);
  const [rows, [total]] = await Promise.all([
    db.select(userFields).from(users).where(where).orderBy(desc(users.createdAt), users.id).limit(25).offset((query.page - 1) * 25),
    db.select({ value: count() }).from(users).where(where),
  ]);
  if (!total) throw new Error("User total unavailable");
  return { items: rows.map(safeUser), total: total.value, page: query.page, pageSize: 25 };
}
export async function getUserOverview(id: string, membershipPage = 1): Promise<AdminUserOverview | null> {
  const [user] = await db.select(userFields).from(users).where(eq(users.id, id)).limit(1);
  if (!user) return null;
  const memberships = await db.select({ tenantId: tenantMembers.tenantId, role: tenantMembers.role, name: tenants.name, status: tenants.status })
    .from(tenantMembers).innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId)).where(eq(tenantMembers.userId, id))
    .orderBy(tenantMembers.createdAt, tenantMembers.tenantId).limit(101).offset((membershipPage - 1) * 100);
  const deliveries = await db.select({ id: emailDeliveries.id, type: emailDeliveries.type, status: emailDeliveries.status,
    attempts: emailDeliveries.attempts, createdAt: emailDeliveries.createdAt, sentAt: emailDeliveries.sentAt })
    .from(emailDeliveries).where(eq(emailDeliveries.userId, id)).orderBy(desc(emailDeliveries.createdAt), emailDeliveries.id).limit(20);
  const [preferences] = await db.select({ dailyDigest: emailPreferences.dailyDigest, weeklySummary: emailPreferences.weeklySummary,
    productUpdates: emailPreferences.productUpdates, unsubscribedAt: emailPreferences.unsubscribedAt })
    .from(emailPreferences).where(eq(emailPreferences.userId, id)).limit(1);
  return { user: safeUser(user), memberships: memberships.slice(0, 100), membershipsTruncated: memberships.length > 100, membershipPage,
    emailHistory: deliveries.map(row => ({ ...row, createdAt: row.createdAt.toISOString(), sentAt: row.sentAt?.toISOString() ?? null })),
    preferences: preferences ? { ...preferences, unsubscribedAt: preferences.unsubscribedAt?.toISOString() ?? null } : null };
}
export function emailDirectoryFilter(query: EmailDirectoryQuery) {
  return and(
    query.q ? or(eq(emailDeliveries.id, query.q), ilike(emailDeliveries.recipient, literal(query.q))) : undefined,
    query.user ? eq(emailDeliveries.userId, query.user) : undefined,
    query.type ? eq(emailDeliveries.type, query.type) : undefined,
    query.status ? eq(emailDeliveries.status, query.status) : undefined,
  );
}
export async function getEmailDirectory(query: EmailDirectoryQuery): Promise<AdminRecordPage<AdminEmailRecord>> {
  const where = emailDirectoryFilter(query);
  const [rows, [total]] = await Promise.all([
    db.select({ id: emailDeliveries.id, userId: emailDeliveries.userId, recipient: emailDeliveries.recipient, type: emailDeliveries.type,
      status: emailDeliveries.status, attempts: emailDeliveries.attempts, createdAt: emailDeliveries.createdAt, sentAt: emailDeliveries.sentAt, retryAt: emailDeliveries.retryAt })
      .from(emailDeliveries).where(where).orderBy(desc(emailDeliveries.createdAt), emailDeliveries.id).limit(25).offset((query.page - 1) * 25),
    db.select({ value: count() }).from(emailDeliveries).where(where),
  ]);
  if (!total) throw new Error("Delivery total unavailable");
  return { items: rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString(), sentAt: row.sentAt?.toISOString() ?? null, retryAt: row.retryAt?.toISOString() ?? null })),
    total: total.value, page: query.page, pageSize: 25 };
}
export async function getAuditDirectory(query: AdminRecordsQuery): Promise<AdminRecordPage<AdminAuditRecord>> {
  const where = auditDirectoryFilter(query);
  const [rows, [total]] = await Promise.all([
    db.select(auditFields).from(auditLog).where(where).orderBy(desc(auditLog.createdAt), auditLog.id).limit(25).offset((query.page - 1) * 25),
    db.select({ value: count() }).from(auditLog).where(where),
  ]);
  if (!total) throw new Error("Audit total unavailable");
  return { items: rows.map(row => ({ ...row, resourceId: row.resourceId?.split("?")[0] ?? null, createdAt: row.createdAt.toISOString() })),
    total: total.value, page: query.page, pageSize: 25 };
}
