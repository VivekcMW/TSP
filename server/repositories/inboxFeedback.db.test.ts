import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { requireLocalTestDatabase } from "../../test/database-safety";
import { feedPreferences, inboxFeedback, inboxItems, tenantMembers, tenants, users } from "@shared/schema";
import type { TenantScope } from "../storage";
import type { NewFeedback } from "../services/feedbackWeights";

// Opt-in AFTER migration 0062 is applied to the explicit local test database.
// Never migrates, reads dotenv or touches development data; imports open no pool when skipped.
const enabled = process.env.INBOX_FEEDBACK_DB_TESTS === "true";

describe.skipIf(!enabled)("inbox feedback and feed preferences PostgreSQL repository (0062 prerequisite)", () => {
  let app: typeof import("../db");
  let owner: typeof import("../../test/db-owner");
  let repo: typeof import("./inboxFeedback");
  const tenantIds: string[] = [], userIds: string[] = [];
  let scope: TenantScope;

  async function makeScope(existing: Partial<TenantScope> = {}): Promise<TenantScope> {
    const userId = existing.userId ?? randomUUID(), tenantId = existing.tenantId ?? randomUUID();
    if (!existing.userId) { await owner.ownerDb.insert(users).values({ id: userId, email: `${userId}@feedback.test` }); userIds.push(userId); }
    if (!existing.tenantId) { await owner.ownerDb.insert(tenants).values({ id: tenantId, kind: "corporate", name: "Feedback fixture" }); tenantIds.push(tenantId); }
    await owner.ownerDb.insert(tenantMembers).values({ tenantId, userId, role: "member" });
    return { tenantId, userId };
  }
  async function story(target = scope, source = "Wire Daily", matchedKeywords = ["Retail media", "CTV"]) {
    const [row] = await owner.ownerDb.insert(inboxItems).values({ ...target, headline: "Story", source, articleUrl: `https://news.test/${randomUUID()}`,
      matchedKeywords, relevanceScore: "0.5", status: "dismissed" }).returning();
    return row;
  }
  const dismissal = (inboxItemId: string, keywords = ["CTV"]): NewFeedback => ({ inboxItemId, kind: "dismiss", reason: "not_my_topic", source: "Wire Daily", keywords });

  beforeAll(async () => {
    const target = requireLocalTestDatabase();
    app = await import("../db");
    owner = await import("../../test/db-owner");
    repo = await import("./inboxFeedback");
    expect((await app.pool.query("select current_user, current_database(), rolbypassrls, rolsuper from pg_roles where rolname = current_user")).rows[0])
      .toEqual({ current_user: "tsp_app", current_database: target.database, rolbypassrls: false, rolsuper: false });
    const ready = await app.pool.query("select to_regclass('public.inbox_feedback') is not null as feedback, to_regclass('public.feed_preferences') is not null as preferences");
    expect(ready.rows[0]).toEqual({ feedback: true, preferences: true });
  });
  beforeEach(async () => { scope = await makeScope(); });
  afterEach(async () => {
    if (tenantIds.length) {
      await owner.ownerDb.delete(inboxFeedback).where(inArray(inboxFeedback.tenantId, tenantIds));
      await owner.ownerDb.delete(feedPreferences).where(inArray(feedPreferences.tenantId, tenantIds));
      await owner.ownerDb.delete(inboxItems).where(inArray(inboxItems.tenantId, tenantIds));
      await owner.ownerDb.delete(tenantMembers).where(inArray(tenantMembers.tenantId, tenantIds));
      await owner.ownerDb.delete(tenants).where(inArray(tenants.id, tenantIds));
    }
    if (userIds.length) await owner.ownerDb.delete(users).where(inArray(users.id, userIds));
    tenantIds.length = 0; userIds.length = 0;
  });
  afterAll(async () => { await app?.pool.end(); await owner?.ownerPool.end(); });

  it("starts empty without creating a row", async () => {
    expect(await repo.inboxFeedbackRepository.preferences(scope)).toEqual({ mutedSources: [], keywordAdjustments: {}, revision: 0, updatedAt: null });
    expect(await repo.inboxFeedbackRepository.load(scope)).toEqual({ mutedSources: [], keywordAdjustments: {} });
    expect((await owner.ownerDb.select().from(feedPreferences).where(eq(feedPreferences.userId, scope.userId))).length).toBe(0);
  });

  it("plans with the caller's own stories only, saves preferences and feedback in one transaction", async () => {
    const mine = await story();
    const colleague = await makeScope({ tenantId: scope.tenantId });
    const theirs = await story(colleague, "Ad Brief");
    const seen: string[][] = [];
    const outcome = await repo.inboxFeedbackRepository.update(scope, [mine.id, theirs.id], (items, current) => {
      seen.push(items.map(item => `${item.id}:${item.source}:${item.matchedKeywords.join("|")}`));
      expect(current).toEqual({ mutedSources: [], keywordAdjustments: {} });
      return { next: { mutedSources: ["Wire Daily"], keywordAdjustments: { CTV: -0.2 } }, feedback: [dismissal(mine.id)], result: "ok" };
    });
    expect(seen).toEqual([[`${mine.id}:Wire Daily:Retail media|CTV`]]);
    expect(outcome).toMatchObject({ result: "ok", preferences: { mutedSources: ["Wire Daily"], keywordAdjustments: { CTV: -0.2 }, revision: 1 } });
    expect(outcome.feedbackIds).toHaveLength(1);
    expect(await repo.inboxFeedbackRepository.load(scope)).toEqual({ mutedSources: ["Wire Daily"], keywordAdjustments: { CTV: -0.2 } });
    expect(await repo.inboxFeedbackRepository.load(colleague)).toEqual({ mutedSources: [], keywordAdjustments: {} });
    const [row] = await owner.ownerDb.select().from(inboxFeedback).where(eq(inboxFeedback.id, outcome.feedbackIds[0]));
    expect(row).toMatchObject({ ...scope, inboxItemId: mine.id, kind: "dismiss", reason: "not_my_topic", keywords: ["CTV"] });
  });

  it("rolls back everything when the plan throws, and keeps the revision for no-op plans", async () => {
    const mine = await story();
    await expect(repo.inboxFeedbackRepository.update(scope, [mine.id], () => { throw new Error("rejected"); })).rejects.toThrow("rejected");
    expect((await owner.ownerDb.select().from(feedPreferences).where(eq(feedPreferences.userId, scope.userId))).length).toBe(0);
    const unchanged = await repo.inboxFeedbackRepository.update(scope, [], (_items, current) => ({ next: current, feedback: [], result: null }));
    expect(unchanged.preferences.revision).toBe(0);
  });

  it("deletes only the caller's feedback by id, prunes old history and keeps feedback when a story is deleted", async () => {
    const mine = await story();
    const colleague = await makeScope({ tenantId: scope.tenantId });
    const [theirs] = await owner.ownerDb.insert(inboxFeedback).values({ ...colleague, ...dismissal(mine.id) }).returning();
    await owner.ownerDb.insert(inboxFeedback).values(Array.from({ length: repo.FEEDBACK_HISTORY_LIMIT + 3 }, (_, index) =>
      ({ ...scope, ...dismissal(mine.id), createdAt: new Date(Date.UTC(2025, 0, 1) + index * 1000) })));
    const added = await repo.inboxFeedbackRepository.update(scope, [mine.id], (_items, current) => ({ next: current, feedback: [dismissal(mine.id)], deleteFeedbackIds: [theirs.id], result: null }));
    const count = async (target: TenantScope) => (await owner.ownerDb.execute(sql`select count(*)::int as n from inbox_feedback where tenant_id = ${target.tenantId} and user_id = ${target.userId}`)).rows[0].n;
    expect(await count(scope)).toBe(repo.FEEDBACK_HISTORY_LIMIT);
    expect(await count(colleague)).toBe(1);
    expect((await owner.ownerDb.select().from(inboxFeedback).where(eq(inboxFeedback.id, added.feedbackIds[0]))).length).toBe(1);

    await owner.ownerDb.delete(inboxItems).where(eq(inboxItems.id, mine.id));
    const [kept] = await owner.ownerDb.select().from(inboxFeedback).where(eq(inboxFeedback.id, added.feedbackIds[0]));
    expect(kept.inboxItemId).toBeNull();
  });

  it("resets only the caller's preferences and history", async () => {
    const mine = await story();
    const colleague = await makeScope({ tenantId: scope.tenantId });
    for (const target of [scope, colleague]) {
      await repo.inboxFeedbackRepository.update(target, [], () => ({ next: { mutedSources: ["Wire Daily"], keywordAdjustments: {} }, feedback: [dismissal(mine.id)], result: null }));
    }
    expect(await repo.inboxFeedbackRepository.reset(scope)).toMatchObject({
      preferences: { mutedSources: [], keywordAdjustments: {}, revision: 2 }, previous: { mutedSources: ["Wire Daily"], keywordAdjustments: {} },
    });
    expect(await repo.inboxFeedbackRepository.load(colleague)).toEqual({ mutedSources: ["Wire Daily"], keywordAdjustments: {} });
    const rows = await owner.ownerDb.select().from(inboxFeedback).where(inArray(inboxFeedback.userId, [scope.userId, colleague.userId]));
    expect(rows.map(row => row.userId)).toEqual([colleague.userId]);
    expect(await repo.inboxFeedbackRepository.reset(await makeScope({ tenantId: scope.tenantId })))
      .toEqual({ preferences: { mutedSources: [], keywordAdjustments: {}, revision: 0, updatedAt: null }, previous: { mutedSources: [], keywordAdjustments: {} } });
  });

  it("reads the state it clears under the row lock, so a change committed meanwhile is part of what Undo restores", async () => {
    await repo.inboxFeedbackRepository.update(scope, [], () => ({ next: { mutedSources: [], keywordAdjustments: { AI: -0.2 } }, feedback: [], result: null }));
    const writer = await owner.ownerPool.connect();
    try {
      await writer.query("begin");
      await writer.query("select 1 from feed_preferences where tenant_id = $1 and user_id = $2 for update", [scope.tenantId, scope.userId]);
      const reset = repo.inboxFeedbackRepository.reset(scope);
      await new Promise(resolve => setTimeout(resolve, 150));
      await writer.query(`update feed_preferences set keyword_adjustments = '{"AI": -0.4}'::jsonb, muted_sources = '["Ad Brief"]'::jsonb, revision = revision + 1
        where tenant_id = $1 and user_id = $2`, [scope.tenantId, scope.userId]);
      await writer.query("commit");
      expect((await reset).previous).toEqual({ mutedSources: ["Ad Brief"], keywordAdjustments: { AI: -0.4 } });
    } finally { writer.release(); }
    expect(await repo.inboxFeedbackRepository.load(scope)).toEqual({ mutedSources: [], keywordAdjustments: {} });
  });

  it("enforces tenant RLS and the stored-value checks for the runtime role", async () => {
    await repo.inboxFeedbackRepository.update(scope, [], () => ({ next: { mutedSources: ["Wire"], keywordAdjustments: {} }, feedback: [], result: null }));
    const client = await app.pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true)", [randomUUID()]);
      expect((await client.query("select count(*)::int as n from feed_preferences")).rows[0].n).toBe(0);
      await expect(client.query("insert into inbox_feedback (tenant_id, user_id, kind) values ($1, $2, 'dismiss')", [scope.tenantId, scope.userId]))
        .rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("rollback");
      client.release();
    }
    await expect(owner.ownerPool.query("update feed_preferences set muted_sources = $3::jsonb where tenant_id = $1 and user_id = $2",
      [scope.tenantId, scope.userId, JSON.stringify(Array.from({ length: 101 }, (_, i) => `s${i}`))])).rejects.toThrow(/feed_preferences_muted_sources/);
    await expect(owner.ownerPool.query("insert into inbox_feedback (tenant_id, user_id, kind, reason) values ($1, $2, 'dismiss', 'boring')", [scope.tenantId, scope.userId]))
      .rejects.toThrow(/inbox_feedback_reason/);
    const flags = await app.pool.query(`select relname, relrowsecurity, relforcerowsecurity from pg_class
      where oid in ('inbox_feedback'::regclass, 'feed_preferences'::regclass) order by relname`);
    expect(flags.rows).toEqual([
      { relname: "feed_preferences", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "inbox_feedback", relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });
});
