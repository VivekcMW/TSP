import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { tenants, tenantMembers } from "@shared/schema";
import { enqueueInboxRefresh, getInboxRefreshQueue, getPublishDraftQueue, QueueUnavailableError } from "../jobs/queue";
import { storage } from "../storage";
import { AdminControlConflict } from "./admin-quotas";

export type AdminQueue = "inbox" | "publishing";
function queueFor(kind: AdminQueue) {
  return kind === "inbox" ? getInboxRefreshQueue() : getPublishDraftQueue();
}
export async function getAdminJob(kind: AdminQueue, id: string) {
  const queue = queueFor(kind);
  if (!queue) throw new QueueUnavailableError();
  const job = await queue.getJob(id);
  if (!job) return null;
  const state = await job.getState();
  const data = job.data;
  const recoverable = kind === "inbox" && state === "failed" && "operationId" in data
    && typeof data.operationId === "string" && !!data.operationId && !!data.userId && !!data.dedupeKey && String(job.id) === data.dedupeKey;
  return { id: String(job.id), queue: kind, state, tenantId: data.tenantId, userId: data.userId ?? null,
    attemptsMade: job.attemptsMade, createdAt: new Date(job.timestamp).toISOString(),
    finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    recoveryEligible: recoverable, operationId: "operationId" in data ? data.operationId ?? null : null };
}
export async function listAdminJobs(kind: AdminQueue, state: "failed" | "waiting" | "active" | "delayed", page: number) {
  const queue = queueFor(kind);
  if (!queue) throw new QueueUnavailableError();
  const jobs = await queue.getJobs([state], (page - 1) * 25, page * 25, false);
  const items = [];
  for (const job of jobs.slice(0, 25)) {
    const row = await getAdminJob(kind, String(job.id));
    if (row) items.push(row);
  }
  return { items, page, hasMore: jobs.length > 25 };
}
export async function recoverDiscoveryJob(id: string, expectedOperationId: string, expectedTenantId: string) {
  const queue = getInboxRefreshQueue();
  if (!queue) throw new QueueUnavailableError();
  const job = await queue.getJob(id);
  if (!job) return null;
  const data = job.data;
  if (data.tenantId !== expectedTenantId || !data.userId || !data.operationId || data.operationId !== expectedOperationId || !data.dedupeKey || String(job.id) !== data.dedupeKey) {
    throw new AdminControlConflict("Recovery requires the original attributable tenant and operation identity");
  }
  const [tenant] = await db.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, data.tenantId)).limit(1);
  const [member] = await db.select({ userId: tenantMembers.userId }).from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, data.tenantId), eq(tenantMembers.userId, data.userId))).limit(1);
  if (tenant?.status !== "active" || !member) throw new AdminControlConflict("Recovery requires an active workspace and current membership");
  const scope = { tenantId: data.tenantId, userId: data.userId };
  const receipt = await storage.getInboxRefreshReceipt(scope, data.operationId, data.autoRefresh ?? false);
  if (receipt) return { outcome: "completed", job: await getAdminJob("inbox", id) };
  const state = await job.getState();
  if (["waiting", "active", "delayed", "completed"].includes(state)) return { outcome: state, job: await getAdminJob("inbox", id) };
  if (state !== "failed") throw new AdminControlConflict("Only retained failed discovery jobs may be recovered");
  // Existing admission owns atomic recovery reservations; never remove/recreate
  // the job or manufacture a new operation identity after an uncertain result.
  await enqueueInboxRefresh({ ...data, manual: true });
  const verified = await getAdminJob("inbox", id);
  if (!verified || !["waiting", "active", "delayed", "completed", "paused"].includes(verified.state)) {
    throw new AdminControlConflict("Recovery admission not verified; inspect the same job before retrying");
  }
  return { outcome: verified.state, job: verified };
}
export async function waitingAge(kind: AdminQueue) {
  const queue = queueFor(kind);
  if (!queue) return { available: false, oldestMs: null, scanned: 0, complete: false };
  let oldest = Date.now(), scanned = 0;
  for (let offset = 0; offset < 5000; offset += 100) {
    const jobs = await queue.getWaiting(offset, offset + 99);
    for (const job of jobs) { oldest = Math.min(oldest, job.timestamp); scanned++; }
    if (jobs.length < 100) return { available: true, oldestMs: scanned ? Math.max(0, Date.now() - oldest) : null, scanned, complete: true };
  }
  return { available: true, oldestMs: Math.max(0, Date.now() - oldest), scanned, complete: false };
}
