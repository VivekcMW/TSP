import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { tenantMembers, tenants, users } from "@shared/schema";
import type { TenantScope } from "../storage";

export interface Recipient { email: string; name: string | null }

// `name` falls back to the email address for accounts created without one (migration 0008).
const greetingName = (firstName: string | null, name: string) => {
  const candidate = firstName?.trim() || name.trim().split(/\s+/)[0] || "";
  return candidate && !candidate.includes("@") ? candidate.slice(0, 60) : null;
};

/** Verified members of active workspaces only, like the weekly summary. */
export async function loadRecipient(scope: TenantScope): Promise<Recipient | null> {
  const [row] = await db.select({ email: users.email, firstName: users.firstName, name: users.name })
    .from(tenantMembers).innerJoin(users, eq(users.id, tenantMembers.userId)).innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .where(and(eq(tenantMembers.tenantId, scope.tenantId), eq(tenantMembers.userId, scope.userId), eq(tenants.status, "active"), eq(users.emailVerified, true)))
    .limit(1);
  return row?.email ? { email: row.email, name: greetingName(row.firstName, row.name) } : null;
}
