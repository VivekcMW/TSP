import { randomUUID } from "node:crypto";
import { requireLocalTestDatabase } from "../test/database-safety";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { pool } from "./db";
import { ownerDb, ownerPool } from "../test/db-owner";
import { inboxItems, tenantMembers, tenants, users, type InboxItem } from "@shared/schema";
import { storage, type TenantScope } from "./storage";

const tenantIds: string[] = [];
const userIds: string[] = [];
let scope: TenantScope;

beforeAll(async () => {
  // No dotenv, migrations, global cleanup or fallback to a developer database.
  const target = requireLocalTestDatabase();
  const runtime = await pool.query("select current_user, current_database(), rolbypassrls, rolsuper from pg_roles where rolname = current_user");
  expect(runtime.rows[0]).toEqual({ current_user: "tsp_app", current_database: target.database, rolbypassrls: false, rolsuper: false });
  const owner = await ownerPool.query("select current_user, current_database()");
  expect(owner.rows[0]).toEqual({ current_user: "vivekanandchoudhari", current_database: target.database });
});

async function makeScope(existing: Partial<TenantScope> = {}): Promise<TenantScope> {
  const userId = existing.userId ?? randomUUID();
  const tenantId = existing.tenantId ?? randomUUID();
  if (!existing.userId) {
    await ownerDb.insert(users).values({ id: userId, email: `${userId}@inbox-relevance.test` });
    userIds.push(userId);
  }
  if (!existing.tenantId) {
    await ownerDb.insert(tenants).values({ id: tenantId, kind: "corporate", name: "Inbox relevance fixture" });
    tenantIds.push(tenantId);
  }
  await ownerDb.insert(tenantMembers).values({ tenantId, userId, role: "member" });
  return { tenantId, userId };
}

beforeEach(async () => { scope = await makeScope(); });
afterEach(async () => {
  // Only this suite's unique fixtures, never another agent's test data.
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

async function seed(overrides: Partial<InboxItem> = {}, target = scope) {
  const id = randomUUID();
  const [item] = await ownerDb.insert(inboxItems).values({
    ...target, id, headline: "Fixture story", source: "Fixture publication", articleUrl: `https://news.test/${id}`,
    createdAt: new Date("2026-09-01T12:00:00Z"), ...overrides,
  }).returning();
  return item;
}

describe("inbox relevance retrieval", () => {
  it("filters status before relevance pagination so 510 high-scoring history rows cannot hide active legacy rows", async () => {
    const history = await ownerDb.insert(inboxItems).values(Array.from({ length: 510 }, (_, i) => ({
      ...scope, headline: `History ${i}`, source: "Fixture", articleUrl: `https://news.test/history/${i}`,
      status: i % 2 ? "saved" : "dismissed", relevanceScore: "1", createdAt: new Date("2026-09-05"),
    }))).returning();
    const low = await seed({ relevanceScore: "0.1", matchedKeywords: [], relevanceReason: null });
    const legacy = await seed({ relevanceScore: null, matchedKeywords: null, relevanceReason: null });
    const duplicate = await seed({ relevanceScore: "0", articleUrl: low.articleUrl, matchedKeywords: [] });
    const expected = [low, duplicate, legacy];
    expect((await storage.getInboxItems(scope, { order: "relevance" })).every(row => row.status !== "active")).toBe(true);
    expect(await storage.getInboxItems(scope, { status: "active", order: "relevance" })).toEqual(expected);
    const first = await storage.getInboxItems(scope, { status: "active", order: "relevance", limit: 1 });
    const rest = await storage.getInboxItems(scope, { status: "active", order: "relevance", limit: 2, offset: 1 });
    expect([...first, ...rest]).toEqual(expected);
    expect(await storage.getInboxItems(scope, { status: "active", order: "relevance", offset: 3 })).toEqual([]);
    for (const status of ["saved", "dismissed"] as const) {
      const rows = await storage.getInboxItems(scope, { status, order: "relevance" });
      expect(rows).toHaveLength(255);
      expect(rows).toEqual(expect.arrayContaining(history.filter(row => row.status === status)));
    }
  });

  it("retains all legacy overcapacity actives across bounded pages without silently hiding or rewriting rows", async () => {
    const rows = await ownerDb.insert(inboxItems).values(Array.from({ length: 510 }, (_, i) => ({
      ...scope, id: `${scope.userId}-${String(i).padStart(3, "0")}`, headline: `Legacy ${i}`, source: "Fixture",
      articleUrl: "https://news.test/legacy-duplicate", relevanceScore: null, matchedKeywords: null,
      relevanceReason: null, status: "active", createdAt: new Date("2026-09-01"),
    }))).returning();
    const first = await storage.getInboxItems(scope, { status: "active", order: "relevance", limit: 1000 });
    expect(first).toHaveLength(500);
    const last = await storage.getInboxItems(scope, { status: "active", order: "relevance", offset: 500 });
    expect([...first, ...last]).toEqual(rows);
  });

  it("applies status in both order modes without crossing tenant/user scopes", async () => {
    const colleague = await makeScope({ tenantId: scope.tenantId });
    const elsewhere = await makeScope({ userId: scope.userId });
    for (const target of [scope, colleague, elsewhere]) {
      const active = await seed({ relevanceScore: "0" }, target);
      await seed({ status: "saved", relevanceScore: "1", createdAt: new Date("2026-09-05") }, target);
      for (const order of [undefined, "relevance"] as const) {
        expect(await storage.getInboxItems(target, { status: "active", order, limit: 1 })).toEqual([active]);
        expect(await storage.getInboxItems(target, { status: "active", order, limit: 1, offset: 1 })).toEqual([]);
      }
    }
  });

  it("orders numeric scores descending before recency, with null after even zero", async () => {
    const low = await seed({ relevanceScore: "0.1", createdAt: new Date("2026-09-03") });
    const legacy = await seed({ relevanceScore: null, createdAt: new Date("2026-09-04") });
    const high = await seed({ relevanceScore: "0.9" });
    const zero = await seed({ relevanceScore: "0" });
    expect((await storage.getInboxItems(scope, { order: "relevance" })).map(item => item.id))
      .toEqual([high.id, low.id, zero.id, legacy.id]);
  });

  it("breaks equal scores by newest createdAt then ascending id, including null scores", async () => {
    const prefix = randomUUID();
    const older = await seed({ relevanceScore: "0.9" });
    const b = await seed({ id: `${prefix}-b`, relevanceScore: "0.9000", createdAt: new Date("2026-09-02") });
    const a = await seed({ id: `${prefix}-a`, relevanceScore: "0.9", createdAt: b.createdAt });
    const nullB = await seed({ id: `${prefix}-null-b`, relevanceScore: null });
    const nullA = await seed({ id: `${prefix}-null-a`, relevanceScore: null });
    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await storage.getInboxItems(scope, { order: "relevance" })).map(item => item.id))
        .toEqual([a.id, b.id, older.id, nullA.id, nullB.id]);
    }
  });

  it("applies pagination after relevance and tie ordering without overlapping pages", async () => {
    const prefix = randomUUID();
    const low = await seed({ relevanceScore: "0.1", createdAt: new Date("2026-09-03") });
    const b = await seed({ id: `${prefix}-b`, relevanceScore: "0.9" });
    const a = await seed({ id: `${prefix}-a`, relevanceScore: "0.9" });
    const first = await storage.getInboxItems(scope, { order: "relevance", limit: 1 });
    const rest = await storage.getInboxItems(scope, { order: "relevance", limit: 2, offset: 1 });
    expect([...first, ...rest].map(item => item.id)).toEqual([a.id, b.id, low.id]);
    expect(await storage.getInboxItems(scope, { order: "relevance", offset: 3 })).toEqual([]);
  });

  it("keeps default retrieval chronological for history and trends consumers", async () => {
    const high = await seed({ relevanceScore: "0.9" });
    const low = await seed({ relevanceScore: "0.1", createdAt: new Date("2026-09-02") });
    const legacy = await seed({ relevanceScore: null, createdAt: new Date("2026-09-03") });
    expect((await storage.getInboxItems(scope)).map(item => item.id)).toEqual([legacy.id, low.id, high.id]);
    expect((await storage.getInboxItems(scope, { limit: 1, offset: 1 })).map(item => item.id)).toEqual([low.id]);
  });

  it("preserves user and tenant scoping before ordering and limiting", async () => {
    const colleague = await makeScope({ tenantId: scope.tenantId });
    const otherTenant = await makeScope({ userId: scope.userId });
    const own = await seed({ relevanceScore: "0.1" });
    const colleagueItem = await seed({ relevanceScore: "0.9" }, colleague);
    const otherItem = await seed({ relevanceScore: "1" }, otherTenant);
    for (const [target, item] of [[scope, own], [colleague, colleagueItem], [otherTenant, otherItem]] as const) {
      expect((await storage.getInboxItems(target, { order: "relevance", limit: 1 })).map(row => row.id)).toEqual([item.id]);
      expect(await storage.getInboxItems(target, { order: "relevance", limit: 1, offset: 1 })).toEqual([]);
    }
  });

  it("keeps active, saved and dismissed legacy rows retrievable without rewriting them", async () => {
    const legacy = await seed({ relevanceScore: null, relevanceReason: null, matchedKeywords: ["Legacy topic"], status: "saved" });
    const dismissed = await seed({ relevanceReason: null, matchedKeywords: null, status: "dismissed" });
    const active = await storage.createInboxItem(scope, { headline: "Source selection", source: "Own source",
      articleUrl: "https://news.test/source-only", relevanceScore: "0.1", matchedKeywords: [],
      relevanceReason: "Selected from an active user source; not a topic match." });
    for (const page of [{}, { order: "relevance" as const }]) {
      const rows = await storage.getInboxItems(scope, page);
      expect(rows).toHaveLength(3);
      expect(rows).toEqual(expect.arrayContaining([
        { ...legacy, canonicalUrl: legacy.articleUrl }, { ...dismissed, canonicalUrl: dismissed.articleUrl }, active,
      ]));
    }
    expect(await storage.getInboxItemByUrl(scope, legacy.articleUrl)).toEqual({ ...legacy, canonicalUrl: legacy.articleUrl });
    expect(await storage.getInboxItemByUrl(scope, dismissed.articleUrl)).toEqual({ ...dismissed, canonicalUrl: dismissed.articleUrl });
  });
});