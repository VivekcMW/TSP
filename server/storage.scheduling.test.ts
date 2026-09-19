import { randomUUID } from "node:crypto";
import { requireLocalTestDatabase } from "../test/database-safety";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "./db";
import { ownerDb, ownerPool } from "../test/db-owner";
import { users, tenants, tenantMembers } from "@shared/schema";
import { storage, type TenantScope } from "./storage";
import { aggregateScheduleStatus } from "./jobs/schedule-state";

// This suite proves real PostgreSQL fencing/RLS, not entitlement/provider policy.
// Policy itself is covered separately with explicitly mocked boundary tests.
vi.mock("./services/publishing-policy", async importOriginal => ({
  ...await importOriginal<typeof import("./services/publishing-policy")>(),
  assertPublishingPolicy: vi.fn().mockResolvedValue(undefined),
}));

// Defense in depth: only explicit matching local test targets, never dev/prod.
requireLocalTestDatabase();
const prefix = `schedule-test-${randomUUID()}`;
const a: TenantScope = { tenantId: `${prefix}-tenant`, userId: `${prefix}-a` };
const coworker: TenantScope = { tenantId: a.tenantId, userId: `${prefix}-b` };
const other: TenantScope = { tenantId: `${prefix}-other`, userId: a.userId };

beforeAll(async () => {
  vi.stubEnv("PUBLISHING_MODE", "live");
  const role = await db.execute(sql`select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user`);
  expect(role.rows[0]).toMatchObject({ current_user: "tsp_app", rolsuper: false, rolbypassrls: false });
  await ownerDb.insert(users).values([{ id: a.userId, email: `${a.userId}@example.test` }, { id: coworker.userId, email: `${coworker.userId}@example.test` }]);
  await ownerDb.insert(tenants).values([{ id: a.tenantId, name: "Schedule test" }, { id: other.tenantId, name: "Other test" }]);
  await ownerDb.insert(tenantMembers).values([{ ...a, role: "owner" }, { ...coworker, role: "member" }, { ...other, role: "owner" }]);
});
afterAll(async () => {
  // Delete only this suite's unique fixtures, never global/truncate cleanup.
  await ownerDb.execute(sql`delete from publish_job_logs where tenant_id in (${a.tenantId}, ${other.tenantId})`);
  await ownerDb.execute(sql`delete from draft_schedule_targets where tenant_id in (${a.tenantId}, ${other.tenantId})`);
  await ownerDb.execute(sql`delete from draft_schedules where tenant_id in (${a.tenantId}, ${other.tenantId})`);
  await ownerDb.execute(sql`delete from drafts where tenant_id in (${a.tenantId}, ${other.tenantId})`);
  await ownerDb.execute(sql`delete from tenant_members where tenant_id in (${a.tenantId}, ${other.tenantId})`);
  await ownerDb.execute(sql`delete from tenants where id in (${a.tenantId}, ${other.tenantId})`);
  await ownerDb.execute(sql`delete from users where id in (${a.userId}, ${coworker.userId})`);
  await pool.end(); await ownerPool.end();
  vi.unstubAllEnvs();
});

async function fixture(platforms = ["linkedin", "twitter"]) {
  const draft = await storage.createDraft(a, { platform: "linkedin", tone: "professional", content: "Scheduling test" });
  const schedule = await storage.scheduleDraftPublish(a, draft.id, new Date(Date.now() - 1000), platforms);
  const targets = await storage.getDraftScheduleTargets(a, schedule.id);
  const data = (index: number) => ({ ...a, draftId: draft.id, draftScheduleId: schedule.id, draftScheduleTargetId: targets[index].id, platform: targets[index].platform, publishAt: schedule.scheduledPublishAt });
  const finish = async (index: number, status: "published" | "failed" | "unknown") => {
    const current = (await storage.getDraftScheduleTargets(a, schedule.id)).find(target => target.id === targets[index].id)!;
    return storage.finishPublishTarget(a, targets[index].id, status, {
      draftId: draft.id, platform: targets[index].platform, status, claimToken: current.claimToken, executionMode: current.executionMode,
      receiptKind: status === "published" ? "provider_id" : "none", publishedPostId: status === "published" ? "provider-post" : null, errorMessage: status === "published" ? null : "test failure",
    });
  };
  return { draft, schedule, targets, data, finish };
}

describe("aggregate schedule outcomes", () => {
  it.each([
    [["published", "scheduled"], "scheduled"], [["failed", "publishing"], "publishing"],
    [["published", "failed"], "failed"], [["published", "published"], "published"],
    [["published", "cancelled"], "partial"], [["cancelled", "cancelled"], "cancelled"],
    [["unknown", "published"], "unknown"],
  ])("aggregates %j as %s", (states, expected) => expect(aggregateScheduleStatus(states as string[])).toBe(expected));
});

describe("transactional scheduling and RLS", () => {
  it("correlates live receipts to each draft before paginating without changing stored history", async () => {
    const live = await fixture();
    for (const index of [0, 1]) {
      expect(await storage.claimPublishTarget(a, live.data(index))).toBeDefined();
      expect(await live.finish(index, "published")).toBe(true);
    }
    const emptySchedule = await fixture(["linkedin"]);
    await ownerDb.execute(sql`delete from draft_schedule_targets where draft_schedule_id = ${emptySchedule.schedule.id}`);
    const noSchedule = await storage.createDraft(a, { platform: "linkedin", tone: "professional", content: "No receipt" });
    const ready = await storage.createDraft(a, { platform: "linkedin", tone: "professional", content: "Untouched" });
    const ids = [live.draft.id, emptySchedule.draft.id, noSchedule.id, ready.id];
    for (const [index, id] of ids.entries()) {
      await ownerDb.execute(sql`update drafts set updated_at = ${new Date(Date.UTC(2100, 0, 4 - index))},
        publish_status = ${index === 3 ? "draft" : "published"}, published_at = ${index === 3 ? null : new Date(0)} where id = ${id}`);
    }
      const storedLive = await storage.getDraft(a, live.draft.id);
      const storedLegacy = await storage.getDraft(a, noSchedule.id);
      expect(storedLive?.publishedAt).toBeInstanceOf(Date);
      expect(storedLegacy?.publishedAt).toBeInstanceOf(Date);
    const first = await storage.getDrafts(a, { limit: 2 });
    const second = await storage.getDrafts(a, { limit: 2, offset: 2 });
    expect([...first, ...second].map(row => [row.id, row.publishStatus])).toEqual([
      [live.draft.id, "published"], [emptySchedule.draft.id, "legacy_unverified"],
      [noSchedule.id, "legacy_unverified"], [ready.id, "draft"],
    ]);
    expect(first[0].publishedAt).toEqual(storedLive!.publishedAt);
    expect(first[1].publishedAt).toBeNull();
    expect(second[0].publishedAt).toBeNull();
    expect(await storage.getDraft(a, noSchedule.id)).toEqual(storedLegacy);
    for (const scope of [coworker, other]) expect(await storage.getDrafts(scope)).toEqual([]);
  });
  it.each([
    { label: "non-published sibling", status: "failed", mode: "live", kind: "provider_id", postId: "provider-post" },
    { label: "missing mode", status: "published", mode: null, kind: "provider_id", postId: "provider-post" },
    { label: "sandbox mode", status: "published", mode: "sandbox", kind: "provider_id", postId: "provider-post" },
    { label: "manual receipt", status: "published", mode: "live", kind: "manual", postId: "provider-post" },
    { label: "missing receipt kind", status: "published", mode: "live", kind: null, postId: "provider-post" },
    { label: "missing provider ID", status: "published", mode: "live", kind: "provider_id", postId: null },
    { label: "blank provider ID", status: "published", mode: "live", kind: "provider_id", postId: "   " },
    { label: "synthetic provider ID", status: "published", mode: "live", kind: "provider_id", postId: "SaNdBoX_fake" },
  ])("does not let a live sibling hide $label in draft lists", async ({ status, mode, kind, postId }) => {
    const f = await fixture();
    await storage.claimPublishTarget(a, f.data(0));
    await f.finish(0, "published");
    await ownerDb.execute(sql`update draft_schedule_targets set status = ${status}, execution_mode = ${mode},
      receipt_kind = ${kind}, provider_post_id = ${postId} where id = ${f.targets[1].id}`);
    await ownerDb.execute(sql`update drafts set publish_status = 'published', published_at = now() where id = ${f.draft.id}`);
    expect((await storage.getDrafts(a)).find(row => row.id === f.draft.id))
      .toMatchObject({ publishStatus: "legacy_unverified", publishedAt: null });
    expect((await storage.getDraft(a, f.draft.id))?.publishStatus).toBe("published");
  });
  it("does not count legacy success flags as live receipts or rewrite their history", async () => {
    const f = await fixture(["linkedin"]);
    await ownerDb.execute(sql`update drafts set publish_status = 'published', published_at = now() where id = ${f.draft.id}`);
    await ownerDb.execute(sql`update draft_schedules set status = 'published' where id = ${f.schedule.id}`);
    await ownerDb.execute(sql`update draft_schedule_targets set status = 'published', execution_mode = null where draft_schedule_id = ${f.schedule.id}`);
    expect((await storage.getDrafts(a)).find(draft => draft.id === f.draft.id)).toMatchObject({ publishStatus: "legacy_unverified", publishedAt: null });
    expect((await storage.getDraftPublishStatus(a, f.draft.id))?.schedule?.status).toBe("legacy_unverified");
    expect((await storage.getScheduledDraftsByStatus(a, "published")).some(schedule => schedule.id === f.schedule.id)).toBe(false);
    expect((await storage.getDraft(a, f.draft.id))?.publishStatus).toBe("published");
    await expect(storage.scheduleDraftPublish(a, f.draft.id, new Date())).rejects.toThrow("already published");
  });
  it("audits one concurrent reconciliation winner and fences the old worker", async () => {
    const f = await fixture(["linkedin"]);
    const claimed = await storage.claimPublishTarget(a, f.data(0));
    await f.finish(0, "unknown");
    const [target] = await storage.getDraftScheduleTargets(a, f.schedule.id);
    const decision = { expectedRevision: target.revision, decision: "not_delivered" as const, note: "Operator checked provider and stopped worker", workerStopped: true };
    for (const scope of [coworker, other]) expect(await storage.reconcilePublishTarget(scope, f.draft.id, target.id, decision)).toBeUndefined();
    const results = await Promise.allSettled([storage.reconcilePublishTarget(a, f.draft.id, target.id, decision), storage.reconcilePublishTarget(a, f.draft.id, target.id, decision)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await storage.finishPublishTarget(a, target.id, "published", { draftId: f.draft.id, platform: target.platform, status: "published", claimToken: claimed!.publishClaim.token, executionMode: "live", receiptKind: "provider_id", publishedPostId: "late-receipt" })).toBe(false);
    const logs = await storage.getPublishLogs(a, f.draft.id);
    expect(logs.filter(log => log.evidence)).toHaveLength(1);
    expect(logs.find(log => log.evidence)).toMatchObject({ actorUserId: a.userId, receiptKind: "manual", evidence: { previousStatus: "unknown", previousRevision: target.revision } });
    expect(await storage.getPublishLogs(coworker, f.draft.id)).toEqual([]);
  });
  it("preserves manual receipts through cancellation and forbids replay", async () => {
    const f = await fixture(["linkedin"]);
    await storage.claimPublishTarget(a, f.data(0)); await f.finish(0, "unknown");
    const [target] = await storage.getDraftScheduleTargets(a, f.schedule.id);
    await storage.reconcilePublishTarget(a, f.draft.id, target.id, { expectedRevision: target.revision, decision: "delivered", note: "Operator inspected matching provider post", receipt: "post-123", workerStopped: true });
    await expect(storage.cancelDraftScheduleTarget(a, f.draft.id, target.id)).rejects.toThrow();
    await storage.cancelDraftSchedule(a, f.draft.id);
    expect((await storage.getDraftSchedule(a, f.draft.id))?.status).toBe("manual_published");
    expect((await storage.getDraft(a, f.draft.id))?.publishedAt).toBeNull();
    await expect(storage.scheduleDraftPublish(a, f.draft.id, new Date())).rejects.toThrow("Copy");
    await expect(storage.retryDraftScheduleTargets(a, f.draft.id)).rejects.toThrow();
  });
  it("returns an owned schedule snapshot and distinguishes no schedule from no access", async () => {
    const draft = await storage.createDraft(a, { platform: "linkedin", tone: "professional", content: "Unscheduled" });
    expect(await storage.getDraftPublishStatus(a, draft.id)).toEqual({ schedule: null });
    const f = await fixture();
    const snapshot = await storage.getDraftPublishStatus(a, f.draft.id);
    expect(snapshot?.schedule).toMatchObject({ id: f.schedule.id, status: "scheduled" });
    expect(snapshot?.schedule?.targets.map(target => target.id).sort()).toEqual(f.targets.map(target => target.id).sort());
    for (const scope of [coworker, other]) expect(await storage.getDraftPublishStatus(scope, f.draft.id)).toBeUndefined();
    expect(await storage.getDraftPublishStatus(a, randomUUID())).toBeUndefined();
  });
  it("never mixes parent and targets while sibling outcomes commit concurrently", async () => {
    const f = await fixture();
    await Promise.all([storage.claimPublishTarget(a, f.data(0)), storage.claimPublishTarget(a, f.data(1))]);
    const snapshots = await Promise.all([
      storage.getDraftPublishStatus(a, f.draft.id),
      f.finish(0, "published").then(() => storage.getDraftPublishStatus(a, f.draft.id)),
      f.finish(1, "published").then(() => storage.getDraftPublishStatus(a, f.draft.id)),
      ...Array.from({ length: 12 }, () => storage.getDraftPublishStatus(a, f.draft.id)),
    ]);
    for (const snapshot of snapshots) {
      expect(snapshot?.schedule).toBeDefined();
      expect(snapshot!.schedule!.status).toBe(aggregateScheduleStatus(snapshot!.schedule!.targets.map(target => target.status)));
    }
    expect((await storage.getDraftPublishStatus(a, f.draft.id))?.schedule?.status).toBe("published");
  });
  it("allows unscheduled draft edits and does not leak other users' records", async () => {
    const draft = await storage.createDraft(a, { platform: "linkedin", tone: "professional", content: "Original" });
    expect((await storage.updateDraft(a, draft.id, { content: "Edited" }))?.content).toBe("Edited");
    for (const scope of [coworker, other]) expect(await storage.updateDraft(scope, draft.id, { content: "Attack" })).toBeUndefined();
  });
  it.each(["published", "partial", "unknown", "publishing"])("blocks legacy %s schedules even with a stale draft status", async (status) => {
    const f = await fixture();
    await ownerDb.execute(sql`delete from draft_schedule_targets where draft_schedule_id = ${f.schedule.id}`);
    await ownerDb.execute(sql`update draft_schedules set status = ${status} where id = ${f.schedule.id}`);
    await expect(storage.updateDraft(a, f.draft.id, { content: "Overwrite", status: "draft" })).rejects.toThrow("immutable");
    expect((await storage.getDraft(a, f.draft.id))?.content).toBe(f.draft.content);
  });
  it.each(["published", "unknown"])("blocks %s targets even when the parent rolls up as scheduled/failed", async (status) => {
    const f = await fixture();
    await storage.claimPublishTarget(a, f.data(0));
    await f.finish(0, status as "published" | "unknown");
    await expect(storage.updateDraft(a, f.draft.id, { content: "Overwrite" })).rejects.toThrow("immutable");
    if (status === "published") {
      await storage.claimPublishTarget(a, f.data(1)); await f.finish(1, "failed");
      await expect(storage.updateDraft(a, f.draft.id, { status: "draft" })).rejects.toThrow("immutable");
      expect(await storage.retryDraftScheduleTargets(a, f.draft.id, f.targets[1].id)).toHaveLength(1);
    }
  });
  it("serializes an edit against a worker claim, never rewriting claimed content", async () => {
    const f = await fixture(["linkedin"]);
    const [edit, claim] = await Promise.allSettled([
      storage.updateDraft(a, f.draft.id, { content: "Before claim" }),
      storage.claimPublishTarget(a, f.data(0)),
    ]);
    expect(claim.status).toBe("fulfilled");
    if (claim.status === "fulfilled") expect(claim.value?.content).toBe(edit.status === "fulfilled" ? "Before claim" : f.draft.content);
    await expect(storage.updateDraft(a, f.draft.id, { content: "After claim" })).rejects.toThrow("immutable");
  });
  it("blocks published draft flags and durable receipts even without schedules", async () => {
    for (const evidence of ["status", "publishedAt", "publishStatus", "receipt"]) {
      const draft = await storage.createDraft(a, { platform: "linkedin", tone: "professional", content: "Original" });
      if (evidence === "status") await ownerDb.execute(sql`update drafts set status = 'published' where id = ${draft.id}`);
      if (evidence === "publishedAt") await ownerDb.execute(sql`update drafts set published_at = now() where id = ${draft.id}`);
      if (evidence === "publishStatus") await ownerDb.execute(sql`update drafts set publish_status = 'published' where id = ${draft.id}`);
      if (evidence === "receipt") await storage.createPublishLog(a, { draftId: draft.id, platform: "linkedin", status: "published", publishedPostId: "receipt" });
      await expect(storage.updateDraft(a, draft.id, { content: "Overwrite", status: "draft" })).rejects.toThrow("immutable");
    }
  });
  it("reads due schedules with restricted RLS but not without a scope", async () => {
    const f = await fixture();
    expect((await storage.getScheduledDraftsForPublishing(a)).some((row) => row.id === f.schedule.id)).toBe(true);
    expect((await storage.getScheduledDraftsForPublishing(coworker)).some((row) => row.id === f.schedule.id)).toBe(false);
    expect((await storage.getScheduledDraftsForPublishing(other)).some((row) => row.id === f.schedule.id)).toBe(false);
    expect((await db.execute(sql`select id from draft_schedules where id = ${f.schedule.id}`)).rows).toHaveLength(0);
    expect((await storage.getSchedulerScopes()).some((scope) => scope.tenantId === a.tenantId)).toBe(true);
  });

  it("claims one target only once under concurrent workers", async () => {
    const f = await fixture();
    const claims = await Promise.all([storage.claimPublishTarget(a, f.data(0)), storage.claimPublishTarget(a, f.data(0))]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await f.finish(0, "published");
    expect(await storage.claimPublishTarget(a, f.data(0))).toBeUndefined();
    expect((await storage.getDraftSchedule(a, f.draft.id))?.status).toBe("scheduled");
    expect((await storage.getDraft(a, f.draft.id))?.publishStatus).toBe("scheduled");
    expect(await storage.claimPublishTarget(a, f.data(1))).toBeDefined();
    await f.finish(1, "published");
    expect((await storage.getDraftSchedule(a, f.draft.id))?.status).toBe("published");
    expect((await storage.getDraft(a, f.draft.id))?.publishStatus).toBe("published");
  });

  it("serializes simultaneous sibling outcomes without last-writer status loss", async () => {
    const f = await fixture();
    await Promise.all([storage.claimPublishTarget(a, f.data(0)), storage.claimPublishTarget(a, f.data(1))]);
    await Promise.all([f.finish(0, "published"), f.finish(1, "failed")]);
    expect((await storage.getDraftSchedule(a, f.draft.id))?.status).toBe("failed");
    const retry = await storage.retryDraftScheduleTargets(a, f.draft.id, f.targets[1].id);
    expect(retry).toHaveLength(1); expect(retry![0].id).not.toBe(f.targets[1].id);
    expect(await storage.claimPublishTarget(a, f.data(1))).toBeUndefined();
    expect((await storage.getDraftScheduleTargets(a, f.schedule.id)).find((target) => target.id === f.targets[0].id)?.status).toBe("published");
  });

  it("cancels one target without affecting siblings and fences stale jobs", async () => {
    const f = await fixture();
    await storage.cancelDraftScheduleTarget(a, f.draft.id, f.targets[0].id);
    expect(await storage.claimPublishTarget(a, f.data(0))).toBeUndefined();
    expect(await storage.claimPublishTarget(a, f.data(1))).toBeDefined();
    await expect(storage.cancelDraftSchedule(a, f.draft.id)).rejects.toThrow("in flight");
    await f.finish(1, "published");
    expect((await storage.getDraftSchedule(a, f.draft.id))?.status).toBe("partial");
  });

  it("reschedules with new generation IDs and preserves all platform choices", async () => {
    const f = await fixture();
    await storage.scheduleDraftPublish(a, f.draft.id, f.schedule.scheduledPublishAt);
    expect(await storage.claimPublishTarget(a, f.data(0))).toBeUndefined();
    const targets = await storage.getDraftScheduleTargets(a, f.schedule.id);
    expect(targets.map((target) => target.platform).sort()).toEqual(["linkedin", "twitter"]);
    expect(targets.every((target) => !f.targets.some((old) => old.id === target.id))).toBe(true);
    await storage.cancelDraftSchedule(a, f.draft.id);
    expect((await storage.getDraftScheduleTargets(a, f.schedule.id)).every((target) => target.status === "cancelled")).toBe(true);
  });

  it("fails closed for missing/legacy/mismatched/future jobs", async () => {
    const f = await fixture();
    for (const data of [{ ...f.data(0), draftScheduleTargetId: undefined }, { ...f.data(0), draftScheduleTargetId: "missing" }, { ...f.data(0), platform: "telegram" }, { ...f.data(0), draftId: "wrong" }, { ...f.data(0), publishAt: new Date(0) }]) {
      expect(await storage.claimPublishTarget(a, data)).toBeUndefined();
    }
    const future = await storage.scheduleDraftPublish(a, f.draft.id, new Date(Date.now() + 60_000));
    const [target] = await storage.getDraftScheduleTargets(a, future.id);
    expect(await storage.claimPublishTarget(a, { ...f.data(0), draftScheduleTargetId: target.id, platform: target.platform, publishAt: future.scheduledPublishAt })).toBeUndefined();
  });

  it("blocks own-tenant coworker and cross-tenant reads/mutations", async () => {
    const f = await fixture();
    for (const scope of [coworker, other]) {
      expect(await storage.getDraftSchedule(scope, f.draft.id)).toBeUndefined();
      expect(await storage.getDraftScheduleTargets(scope, f.schedule.id)).toEqual([]);
      expect(await storage.claimPublishTarget(scope, f.data(0))).toBeUndefined();
      expect(await storage.cancelDraftScheduleTarget(scope, f.draft.id, f.targets[0].id)).toBeUndefined();
      expect(await storage.retryDraftScheduleTargets(scope, f.draft.id, f.targets[0].id)).toBeUndefined();
      await expect(storage.scheduleDraftPublish(scope, f.draft.id, new Date())).rejects.toThrow("Draft not found");
      await storage.cancelDraftSchedule(scope, f.draft.id);
    }
    expect((await storage.getDraftSchedule(a, f.draft.id))?.status).toBe("scheduled");
  });

  it("does not retry or reschedule unknown outcomes", async () => {
    const f = await fixture(["linkedin"]);
    await storage.claimPublishTarget(a, f.data(0)); await f.finish(0, "unknown");
    await expect(storage.retryDraftScheduleTargets(a, f.draft.id, f.targets[0].id)).rejects.toThrow("reconciliation");
    await expect(storage.scheduleDraftPublish(a, f.draft.id, new Date())).rejects.toThrow("unknown");
    expect(await storage.claimPublishTarget(a, f.data(0))).toBeUndefined();
  });
  it("linearizes cancel against a worker claim", async () => {
    const f = await fixture(["linkedin"]);
    const [cancel, claim] = await Promise.allSettled([
      storage.cancelDraftScheduleTarget(a, f.draft.id, f.targets[0].id),
      storage.claimPublishTarget(a, f.data(0)),
    ]);
    if (cancel.status === "fulfilled") {
      expect(claim).toEqual({ status: "fulfilled", value: undefined });
      expect((await storage.getDraftSchedule(a, f.draft.id))?.status).toBe("cancelled");
    } else {
      expect(claim.status).toBe("fulfilled");
      expect((await storage.getDraftSchedule(a, f.draft.id))?.status).toBe("publishing");
    }
  });
  it("does not allow duplicate manual retries to replace the same failed target twice", async () => {
    const f = await fixture(["linkedin"]);
    await storage.claimPublishTarget(a, f.data(0)); await f.finish(0, "failed");
    const attempts = await Promise.all([
      storage.retryDraftScheduleTargets(a, f.draft.id, f.targets[0].id),
      storage.retryDraftScheduleTargets(a, f.draft.id, f.targets[0].id),
    ]);
    expect(attempts.filter(Boolean)).toHaveLength(1);
  });
  it("prevents legacy helpers from overwriting successful or cancelled outcomes", async () => {
    const f = await fixture();
    await expect(storage.markDraftAsPublished(a, f.draft.id)).rejects.toThrow("derived");
    await storage.cancelDraftSchedule(a, f.draft.id);
    await expect(storage.updateDraftScheduleStatus(a, f.schedule.id, "scheduled")).rejects.toThrow("derived");
    expect(await storage.updateDraftScheduleTargetStatus(a, f.targets[0].id, "queued")).toBeUndefined();
  });
  it("does not restore a cancelled sibling on a time-only reschedule", async () => {
    const f = await fixture();
    await storage.cancelDraftScheduleTarget(a, f.draft.id, f.targets[0].id);
    await storage.scheduleDraftPublish(a, f.draft.id, new Date(Date.now() + 60_000));
    expect((await storage.getDraftScheduleTargets(a, f.schedule.id)).map((target) => target.platform)).toEqual([f.targets[1].platform]);
  });
});