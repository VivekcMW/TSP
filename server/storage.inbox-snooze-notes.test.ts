import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireLocalTestDatabase } from "../test/database-safety";
import { inboxItems, inboxReads, inboxRefreshReceipts, tenantMembers, tenants, userNotes, users, type InsertInboxItem } from "@shared/schema";
import type { TenantScope } from "./storage";

// Opt-in AFTER migration 0059 is applied to the explicit local test database.
// Never migrates, reads dotenv or touches development data; imports open no pool when skipped.
const enabled = process.env.INBOX_SNOOZE_NOTES_DB_TESTS === "true";

describe.skipIf(!enabled)("inbox unread/snooze and notes PostgreSQL storage (0059 prerequisite)", () => {
  let app: typeof import("./db");
  let owner: typeof import("../test/db-owner");
  let repo: typeof import("./storage");
  const tenantIds: string[] = [], userIds: string[] = [];
  let scope: TenantScope;
  const metrics = { articlesProcessed: 3, articlesMatched: 3, durationMs: 1 };
  const DAY = 24 * 60 * 60 * 1000;
  const candidate = (slug: string): Omit<InsertInboxItem, "tenantId" | "userId"> => ({
    headline: `Story ${slug}`, source: "Fixture", articleUrl: `https://news.test/${slug}`, relevanceScore: "0.5", status: "active",
  });

  async function makeScope(existing: Partial<TenantScope> = {}): Promise<TenantScope> {
    const userId = existing.userId ?? randomUUID(), tenantId = existing.tenantId ?? randomUUID();
    if (!existing.userId) { await owner.ownerDb.insert(users).values({ id: userId, email: `${userId}@snooze-notes.test` }); userIds.push(userId); }
    if (!existing.tenantId) { await owner.ownerDb.insert(tenants).values({ id: tenantId, kind: "corporate", name: "Snooze notes fixture" }); tenantIds.push(tenantId); }
    await owner.ownerDb.insert(tenantMembers).values({ tenantId, userId, role: "member" });
    return { tenantId, userId };
  }
  async function seed(n: number, status = "active", target = scope) {
    const prefix = randomUUID();
    return owner.ownerDb.insert(inboxItems).values(Array.from({ length: n }, (_, i) => ({
      ...candidate(`${prefix}/${i}`), ...target, status, createdAt: new Date(1000 + i),
    }))).returning();
  }
  const ids = (rows: { id: string }[]) => rows.map(row => row.id).sort();

  beforeAll(async () => {
    const target = requireLocalTestDatabase();
    app = await import("./db");
    owner = await import("../test/db-owner");
    repo = await import("./storage");
    expect((await app.pool.query("select current_user, current_database(), rolbypassrls, rolsuper from pg_roles where rolname = current_user")).rows[0])
      .toEqual({ current_user: "tsp_app", current_database: target.database, rolbypassrls: false, rolsuper: false });
    const ready = await app.pool.query(`select to_regclass('public.user_notes') is not null as notes,
      exists (select 1 from information_schema.columns where table_name = 'inbox_items' and column_name = 'snoozed_until') as snooze`);
    expect(ready.rows[0]).toEqual({ notes: true, snooze: true });
  });
  beforeEach(async () => { scope = await makeScope(); });
  afterEach(async () => {
    if (tenantIds.length) {
      await owner.ownerDb.delete(userNotes).where(inArray(userNotes.tenantId, tenantIds));
      await owner.ownerDb.delete(inboxItems).where(inArray(inboxItems.tenantId, tenantIds));
      await owner.ownerDb.delete(inboxRefreshReceipts).where(inArray(inboxRefreshReceipts.tenantId, tenantIds));
      await owner.ownerDb.delete(tenantMembers).where(inArray(tenantMembers.tenantId, tenantIds));
      await owner.ownerDb.delete(tenants).where(inArray(tenants.id, tenantIds));
    }
    if (userIds.length) await owner.ownerDb.delete(users).where(inArray(users.id, userIds));
    tenantIds.length = 0; userIds.length = 0;
  });
  afterAll(async () => { await app?.pool.end(); await owner?.ownerPool.end(); });

  describe("markInboxItemUnread", () => {
    it("removes only the caller's read row and is idempotent", async () => {
      const [mine] = await seed(1);
      const other = await makeScope({ tenantId: scope.tenantId });
      await repo.storage.markInboxItemRead(scope, mine.id);
      await owner.ownerDb.insert(inboxReads).values({ ...other, inboxItemId: mine.id });

      expect(await repo.storage.markInboxItemUnread(scope, mine.id)).toBe(true);
      expect(await repo.storage.markInboxItemUnread(scope, mine.id)).toBe(true);
      expect((await repo.storage.getInboxItems(scope)).find(item => item.id === mine.id)?.readAt).toBeNull();
      const rows = await owner.ownerDb.select().from(inboxReads).where(eq(inboxReads.inboxItemId, mine.id));
      expect(rows.map(row => row.userId)).toEqual([other.userId]);
    });

    it("returns false for missing items and another user's item, leaving their read state", async () => {
      const other = await makeScope({ tenantId: scope.tenantId });
      const [theirs] = await seed(1, "active", other);
      await repo.storage.markInboxItemRead(other, theirs.id);
      expect(await repo.storage.markInboxItemUnread(scope, theirs.id)).toBe(false);
      expect(await repo.storage.markInboxItemUnread(scope, randomUUID())).toBe(false);
      expect(await owner.ownerDb.select().from(inboxReads).where(eq(inboxReads.inboxItemId, theirs.id))).toHaveLength(1);
    });
  });

  describe("snoozeInboxItem and the snoozed list filter", () => {
    it("snoozes, filters and clears an active item, bumping its version", async () => {
      const [snoozed, plain, expired] = await seed(3);
      await owner.ownerDb.update(inboxItems).set({ snoozedUntil: new Date(Date.now() - DAY) }).where(eq(inboxItems.id, expired.id));
      const until = new Date(Date.now() + DAY);
      const updated = await repo.storage.snoozeInboxItem(scope, snoozed.id, until);
      expect(updated?.snoozedUntil?.toISOString()).toBe(until.toISOString());
      expect(updated?.version).toBe(snoozed.version + 1);

      expect(ids(await repo.storage.getInboxItems(scope, { status: "active", snoozed: "exclude" }))).toEqual(ids([plain, expired]));
      expect(ids(await repo.storage.getInboxItems(scope, { status: "active", snoozed: "only" }))).toEqual([snoozed.id]);
      expect(ids(await repo.storage.getInboxItems(scope, { status: "active" }))).toEqual(ids([snoozed, plain, expired]));

      const cleared = await repo.storage.snoozeInboxItem(scope, snoozed.id, null);
      expect(cleared?.snoozedUntil).toBeNull();
      expect(cleared?.version).toBe(snoozed.version + 2);
      expect(await repo.storage.getInboxItems(scope, { status: "active", snoozed: "only" })).toEqual([]);
    });

    it("clears the snooze when the story is triaged so restoring it does not keep it hidden", async () => {
      const [item] = await seed(1);
      await repo.storage.snoozeInboxItem(scope, item.id, new Date(Date.now() + DAY));
      const saved = await repo.storage.updateInboxItem(scope, item.id, { status: "saved" });
      expect(saved?.snoozedUntil).toBeNull();
      await repo.storage.updateInboxItem(scope, item.id, { status: "active" });
      expect(ids(await repo.storage.getInboxItems(scope, { status: "active", snoozed: "exclude" }))).toEqual([item.id]);
    });

    it("rejects saved/dismissed items and does not see another user's items", async () => {
      const [saved] = await seed(1, "saved");
      const [dismissed] = await seed(1, "dismissed");
      const until = new Date(Date.now() + DAY);
      await expect(repo.storage.snoozeInboxItem(scope, saved.id, until)).rejects.toBeInstanceOf(repo.InboxSnoozeError);
      await expect(repo.storage.snoozeInboxItem(scope, dismissed.id, null)).rejects.toThrow("Only stories in For you can be snoozed.");

      const other = await makeScope({ tenantId: scope.tenantId });
      const [theirs] = await seed(1, "active", other);
      expect(await repo.storage.snoozeInboxItem(scope, theirs.id, until)).toBeUndefined();
      expect(await repo.storage.snoozeInboxItem(scope, randomUUID(), until)).toBeUndefined();
      const [row] = await owner.ownerDb.select().from(inboxItems).where(eq(inboxItems.id, theirs.id));
      expect(row.snoozedUntil).toBeNull();
    });
  });

  describe("auto-refresh replacement", () => {
    async function refresh(slugs: string[]) {
      const operationId = randomUUID();
      const begin = await repo.storage.beginInboxRefresh(scope, operationId, true);
      return repo.storage.commitInboxRefresh(scope, operationId, true, begin.snapshot, slugs.map(candidate), metrics);
    }

    it("never replaces stories that are still snoozed, but may replace expired snoozes", async () => {
      const old = await seed(10);
      await owner.ownerDb.update(inboxItems).set({ snoozedUntil: new Date(Date.now() + DAY) }).where(inArray(inboxItems.id, [old[0].id, old[1].id]));
      await owner.ownerDb.update(inboxItems).set({ snoozedUntil: new Date(Date.now() - DAY) }).where(eq(inboxItems.id, old[2].id));
      const result = await refresh([randomUUID(), randomUUID(), randomUUID()]);
      expect(result).toMatchObject({ count: 3, replacedCount: 3, activeCount: 10 });
      const dismissed = await owner.ownerDb.select({ id: inboxItems.id }).from(inboxItems)
        .where(and(eq(inboxItems.tenantId, scope.tenantId), eq(inboxItems.status, "dismissed")));
      expect(ids(dismissed)).toEqual(ids([old[2], old[3], old[4]]));
    });

    it("reports capacity when every active story is snoozed", async () => {
      const old = await seed(10);
      await owner.ownerDb.update(inboxItems).set({ snoozedUntil: new Date(Date.now() + DAY) }).where(inArray(inboxItems.id, old.map(row => row.id)));
      expect(await refresh([randomUUID()])).toMatchObject({ count: 0, replacedCount: 0, activeCount: 10, outcome: "capacity" });
    });
  });

  describe("user notes", () => {
    async function seedNotes(n: number, target = scope) {
      return owner.ownerDb.insert(userNotes).values(Array.from({ length: n }, (_, i) => ({
        ...target, text: `Note ${i}`, createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000),
      }))).returning();
    }

    it("lists newest first, capped at 100, for the caller only", async () => {
      const notes = await seedNotes(105);
      await seedNotes(2, await makeScope({ tenantId: scope.tenantId }));
      const listed = await repo.storage.getUserNotes(scope);
      expect(listed).toHaveLength(100);
      expect(listed[0].id).toBe(notes[104].id);
      expect(listed.every(note => note.userId === scope.userId && note.tenantId === scope.tenantId)).toBe(true);
    });

    it("creates up to the 200-note limit", async () => {
      const created = await repo.storage.createUserNote(scope, "First");
      expect(created).toMatchObject({ ...scope, text: "First" });
      await seedNotes(199);
      await expect(repo.storage.createUserNote(scope, "Over")).rejects.toBeInstanceOf(repo.UserNoteLimitError);
      expect(await repo.storage.createUserNote(await makeScope({ tenantId: scope.tenantId }), "Other user")).toMatchObject({ text: "Other user" });
    });

    it("enforces the database text check", async () => {
      await expect(repo.storage.createUserNote(scope, "   ")).rejects.toThrow();
      await expect(repo.storage.createUserNote(scope, "x".repeat(1001))).rejects.toThrow();
    });

    it("updates text and updated_at, and deletes only the caller's notes", async () => {
      const [mine] = await seedNotes(1);
      await owner.ownerDb.update(userNotes).set({ updatedAt: new Date(Date.UTC(2026, 0, 1)) }).where(eq(userNotes.id, mine.id));
      const updated = await repo.storage.updateUserNote(scope, mine.id, "Edited");
      expect(updated?.text).toBe("Edited");
      expect(updated!.updatedAt.getTime()).toBeGreaterThan(Date.UTC(2026, 0, 1));

      const [theirs] = await seedNotes(1, await makeScope({ tenantId: scope.tenantId }));
      expect(await repo.storage.updateUserNote(scope, theirs.id, "Hijack")).toBeUndefined();
      expect(await repo.storage.deleteUserNote(scope, theirs.id)).toBe(false);
      expect(await repo.storage.deleteUserNote(scope, mine.id)).toBe(true);
      expect(await repo.storage.deleteUserNote(scope, mine.id)).toBe(false);
      const [kept] = await owner.ownerDb.select().from(userNotes).where(eq(userNotes.id, theirs.id));
      expect(kept.text).toBe("Note 0");
    });

    it("enforces tenant RLS for the runtime role", async () => {
      await seedNotes(1);
      const client = await app.pool.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('app.tenant_id', $1, true)", [randomUUID()]);
        expect((await client.query("select count(*)::int as n from user_notes")).rows[0].n).toBe(0);
        await expect(client.query("insert into user_notes (tenant_id, user_id, text) values ($1, $2, 'Forged')", [scope.tenantId, scope.userId]))
          .rejects.toThrow(/row-level security/i);
      } finally {
        await client.query("rollback");
        client.release();
      }
      const flags = await app.pool.query("select relrowsecurity, relforcerowsecurity from pg_class where oid = 'user_notes'::regclass");
      expect(flags.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      expect((await owner.ownerDb.execute(sql`select count(*)::int as n from user_notes where tenant_id = ${scope.tenantId}`)).rows[0].n).toBe(1);
    });
  });
});
