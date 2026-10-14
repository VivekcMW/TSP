import { randomUUID } from "node:crypto";
import { requireLocalTestDatabase } from "../test/database-safety";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { pool } from "./db";
import { ownerDb, ownerPool } from "../test/db-owner";
import { discoverVisits, inboxItems, inboxReads, tenantMembers, tenants, users } from "@shared/schema";
import { storage, type TenantScope } from "./storage";

const tenantIds: string[] = [];
const userIds: string[] = [];
let scope: TenantScope;

beforeAll(async () => {
  const target = requireLocalTestDatabase();
  const runtime = await pool.query("select current_user, current_database(), rolbypassrls from pg_roles where rolname = current_user");
  expect(runtime.rows[0]).toEqual({ current_user: "tsp_app", current_database: target.database, rolbypassrls: false });
});

async function makeScope(existing: Partial<TenantScope> = {}): Promise<TenantScope> {
  const userId = existing.userId ?? randomUUID();
  const tenantId = existing.tenantId ?? randomUUID();
  if (!existing.userId) {
    await ownerDb.insert(users).values({ id: userId, email: `${userId}@discover-state.test` });
    userIds.push(userId);
  }
  if (!existing.tenantId) {
    await ownerDb.insert(tenants).values({ id: tenantId, kind: "corporate", name: "Discover state fixture" });
    tenantIds.push(tenantId);
  }
  await ownerDb.insert(tenantMembers).values({ tenantId, userId, role: "member" });
  return { tenantId, userId };
}

async function seed(target = scope) {
  const id = randomUUID();
  const [item] = await ownerDb.insert(inboxItems).values({
    ...target, id, headline: "Fixture story", source: "Fixture publication", articleUrl: `https://news.test/${id}`,
  }).returning();
  return item;
}

beforeEach(async () => { scope = await makeScope(); });
afterEach(async () => {
  // Reads and visits cascade from these fixtures only.
  if (tenantIds.length) {
    await ownerDb.delete(inboxItems).where(inArray(inboxItems.tenantId, tenantIds));
    await ownerDb.delete(tenantMembers).where(inArray(tenantMembers.tenantId, tenantIds));
    await ownerDb.delete(tenants).where(inArray(tenants.id, tenantIds));
  }
  if (userIds.length) await ownerDb.delete(users).where(inArray(users.id, userIds));
  tenantIds.length = 0;
  userIds.length = 0;
});
afterAll(async () => { await pool.end(); await ownerPool.end(); });

describe("Discover visit marker", () => {
  it("has no previous visit first, continues inside the session window, then rotates", async () => {
    const first = await storage.recordDiscoverVisit(scope);
    expect(first.previousVisitAt).toBeNull();
    expect(first.currentVisitAt).toBeInstanceOf(Date);

    // A reload, remount or second device inside the window keeps the same visit.
    expect(await storage.recordDiscoverVisit(scope)).toEqual(first);

    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await ownerDb.update(discoverVisits).set({ currentVisitAt: old })
      .where(and(eq(discoverVisits.tenantId, scope.tenantId), eq(discoverVisits.userId, scope.userId)));
    const next = await storage.recordDiscoverVisit(scope);
    expect(next.previousVisitAt?.toISOString()).toBe(old.toISOString());
    expect(next.currentVisitAt.getTime()).toBeGreaterThan(old.getTime());
  });

  it("keeps markers separate per tenant for the same user", async () => {
    const other = await makeScope({ userId: scope.userId });
    await storage.recordDiscoverVisit(scope);
    await ownerDb.update(discoverVisits).set({ currentVisitAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where(eq(discoverVisits.tenantId, scope.tenantId));
    expect((await storage.recordDiscoverVisit(other)).previousVisitAt).toBeNull();
    expect((await storage.recordDiscoverVisit(scope)).previousVisitAt).not.toBeNull();
  });
});

describe("Discover reading state", () => {
  it("marks reads idempotently and returns readAt on every list page", async () => {
    const read = await seed();
    const unread = await seed();
    const firstReadAt = await storage.markInboxItemRead(scope, read.id);
    expect(firstReadAt).toBeInstanceOf(Date);
    expect(await storage.markInboxItemRead(scope, read.id)).toEqual(firstReadAt);

    const items = await storage.getInboxItems(scope, { limit: 200 });
    const byId = new Map(items.map(item => [item.id, item.readAt]));
    expect(byId.get(read.id)?.toISOString()).toBe(firstReadAt!.toISOString());
    expect(byId.get(unread.id)).toBeNull();
  });

  it("does not read missing or another account's items and never leaks reads across users", async () => {
    const otherUser = await makeScope({ tenantId: scope.tenantId });
    const theirs = await seed(otherUser);
    expect(await storage.markInboxItemRead(scope, theirs.id)).toBeUndefined();
    expect(await storage.markInboxItemRead(scope, randomUUID())).toBeUndefined();

    const mine = await seed();
    await storage.markInboxItemRead(scope, mine.id);
    const rows = await ownerDb.select().from(inboxReads).where(eq(inboxReads.tenantId, scope.tenantId));
    expect(rows.map(row => [row.userId, row.inboxItemId])).toEqual([[scope.userId, mine.id]]);
    expect((await storage.getInboxItems(otherUser)).every(item => item.readAt === null)).toBe(true);
  });

  it("enforces tenant RLS for the runtime role", async () => {
    const mine = await seed();
    await storage.markInboxItemRead(scope, mine.id);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true)", [randomUUID()]);
      const visible = await client.query("select count(*)::int as n from inbox_reads");
      expect(visible.rows[0].n).toBe(0);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
