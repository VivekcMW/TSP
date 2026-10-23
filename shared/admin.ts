import { z } from "zod";

export const tenantDirectoryQuerySchema = z.object({
  q: z.string().trim().max(120).default(""),
  status: z.enum(["all", "active", "suspended", "deleted"]).default("all"),
  kind: z.enum(["all", "personal", "corporate"]).default("all"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
}).strict();
export type TenantDirectoryQuery = z.infer<typeof tenantDirectoryQuerySchema>;
export const ADMIN_TENANT_PAGE_SIZE = 25;

export interface AdminTenant {
  id: string;
  name: string;
  kind: string;
  status: string;
  memberCount: number;
  createdAt: string;
}
export interface TenantDirectory {
  items: AdminTenant[];
  total: number;
  page: number;
  pageSize: number;
}
export interface TenantOverview {
  tenant: Omit<AdminTenant, "memberCount">;
  generatedAt: string;
  counts: { members: number; inboxItems: number; drafts: number; failedSchedules: number; overdueSchedules: number };
  members: { userId: string; name: string; email: string; role: string; onboardingStatus: string | null }[];
  membersTruncated: boolean;
  memberPage: number;
  sources: { id: string; name: string; active: boolean; lastFetchedAt: string | null; lastFetchStatus: string | null }[];
  sourcesTruncated: boolean;
  connections: { id: string; provider: string; active: boolean; lastSyncAt: string | null; tokenExpiresAt: string | null }[];
  connectionsTruncated: boolean;
  recentPayments: { id: string; amount: number; currency: string; status: string; createdAt: string | null }[];
  latestSubscription: { status: string; planId: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  recentRuns: { id: string; status: string; startedAt: string | null; articlesProcessed: number | null; articlesMatched: number | null }[];
  recentSchedules: { id: string; status: string; scheduledPublishAt: string }[];
}
export type AdminQueueCounts = Record<"waiting" | "active" | "completed" | "failed" | "delayed" | "paused", number>;
export interface AdminFailure {
  id: string;
  tenantId: string;
  tenantName: string;
  platform?: string;
  startedAt: string | null;
}
export interface AdminMonitoring {
  generatedAt: string;
  environment: string;
  tenantCount: number;
  queue: { configured: boolean; reachable: boolean; queuesReady: boolean };
  scheduler: { enabled: boolean; designated: boolean; production: boolean };
  jobs: { inbox: AdminQueueCounts | null; publishing: AdminQueueCounts | null };
  scheduled: number;
  publishing: number;
  failed: number;
  overdue: number;
  recentFailures: AdminFailure[];
  engineFailures: AdminFailure[];
  tenantSignals: { tenantId: string; tenantName: string; failed: number; overdue: number }[];
  execution?: {
    available: boolean;
    tasks: { name: string; intervalMinutes: number; state: "never_observed" | "running" | "succeeded" | "failed" | "stale";
      startedAt: string | null; finishedAt: string | null; lastSuccessAt: string | null }[];
  };
}

export const adminRecordsQuerySchema = z.object({
  q: z.string().trim().max(120).default(""),
  actor: z.string().trim().max(100).default(""),
  tenant: z.union([z.literal(""), z.string().uuid()]).default(""),
  action: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).max(10000).default(1),
}).strict();
export type AdminRecordsQuery = z.infer<typeof adminRecordsQuerySchema>;
export interface AdminUserRecord {
  id: string; name: string; email: string; emailVerified: boolean; platformRole: string | null;
  registrationCompleted: string | null; createdAt: string | null;
}
export interface AdminAuditRecord {
  id: string; actorUserId: string | null; actorPlatformRole: string | null; tenantId: string | null;
  action: string; resourceType: string | null; resourceId: string | null; justification: string | null;
  correlationId: string | null; createdAt: string;
}
export interface AdminRecordPage<T> { items: T[]; total: number; page: number; pageSize: number }
export interface AdminUserOverview {
  user: AdminUserRecord;
  memberships: { tenantId: string; name: string; status: string; role: string }[];
  membershipsTruncated: boolean;
  membershipPage: number;
  emailHistory: { id: string; type: string; status: string; attempts: number; createdAt: string; sentAt: string | null }[];
  preferences: { dailyDigest: boolean; weeklySummary: boolean; productUpdates: boolean; unsubscribedAt: string | null } | null;
}

export const emailDirectoryQuerySchema = z.object({
  q: z.string().trim().max(120).default(""),
  user: z.string().trim().max(100).default(""),
  type: z.string().trim().max(60).default(""),
  status: z.enum(["", "pending", "sending", "sent", "failed", "unknown", "suppressed"]).default(""),
  page: z.coerce.number().int().min(1).max(10000).default(1),
}).strict();
export type EmailDirectoryQuery = z.infer<typeof emailDirectoryQuerySchema>;
export interface AdminEmailRecord {
  id: string; userId: string | null; recipient: string; type: string; status: string; attempts: number;
  createdAt: string; sentAt: string | null; retryAt: string | null;
}
