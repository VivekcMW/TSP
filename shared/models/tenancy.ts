import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

/**
 * Tenancy — the universal scope for every piece of domain data.
 *
 * Every user gets a tenant at signup: a personal tenant of one. A corporate
 * account is simply a tenant with more than one member, which is what keeps
 * "add corporate accounts" a feature rather than a migration across a billion
 * inbox rows.
 *
 * Introduced pre-launch, at effectively zero rows, deliberately: retrofitting
 * tenant_id later is the single most expensive change in the architecture.
 */

/** Tenant-scoped roles, least to most privileged. */
export const TENANT_ROLES = ["member", "manager", "admin", "owner"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

/**
 * Platform-wide staff roles. Deliberately separate from tenant roles: these
 * cross tenant boundaries and every use is audited.
 */
export const PLATFORM_ROLES = ["platform_support", "platform_admin"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const TENANT_KINDS = ["personal", "corporate"] as const;
export type TenantKind = (typeof TENANT_KINDS)[number];

export const TENANT_STATUSES = ["active", "suspended", "deleted"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const tenants = pgTable(
  "tenants",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    kind: varchar("kind").notNull().default("personal"),
    name: varchar("name").notNull(),
    /**
     * Set only for corporate tenants, which map to a Clerk Organization.
     * Clerk owns membership and invitations; this column is the join, and the
     * local tables remain authoritative for data scoping and entitlements.
     */
    clerkOrgId: varchar("clerk_org_id").unique(),
    status: varchar("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("idx_tenants_status").on(table.status)],
);

export const tenantMembers = pgTable(
  "tenant_members",
  {
    tenantId: varchar("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role").notNull().default("member"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.userId] }),
    // "which tenants can this user act in?" runs on every request
    index("idx_tenant_members_user").on(table.userId),
  ],
);

/**
 * Append-only record of privileged and cross-tenant actions.
 *
 * Written by the permission middleware rather than by callers, so a new
 * privileged endpoint cannot forget to audit itself.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Null for system-initiated actions (jobs, webhooks). */
    actorUserId: varchar("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Recorded at the time of the action; staff roles change over time. */
    actorPlatformRole: varchar("actor_platform_role"),
    /** The tenant acted upon. Null for platform-level actions. */
    tenantId: varchar("tenant_id").references(() => tenants.id, {
      onDelete: "set null",
    }),
    /** Dotted action name, e.g. "tenant.read", "impersonation.start". */
    action: varchar("action").notNull(),
    resourceType: varchar("resource_type"),
    resourceId: varchar("resource_id"),
    /** Required for cross-tenant reads; the reason the actor gave. */
    justification: text("justification"),
    /** Ties the entry to the request trace that produced it. */
    correlationId: varchar("correlation_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_audit_tenant_created").on(table.tenantId, table.createdAt),
    index("idx_audit_actor_created").on(table.actorUserId, table.createdAt),
    index("idx_audit_action").on(table.action),
  ],
);

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = typeof tenants.$inferInsert;
export type TenantMember = typeof tenantMembers.$inferSelect;
export type InsertTenantMember = typeof tenantMembers.$inferInsert;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type InsertAuditLogEntry = typeof auditLog.$inferInsert;
