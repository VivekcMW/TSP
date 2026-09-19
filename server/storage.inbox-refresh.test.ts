import { randomBytes, randomUUID } from "node:crypto";
import { requireLocalTestDatabase } from "../test/database-safety";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "./db";
import { ownerDb, ownerPool } from "../test/db-owner";
import { drafts, inboxItems, inboxRefreshReceipts, tenantMembers, tenants, users, userProfiles, type InsertInboxItem } from "@shared/schema";
import { canonicalHttpUrl } from "@shared/canonical-url";
import { storage, InboxCapacityError, InboxCanonicalConflictError, InboxOperationConflictError, type TenantScope } from "./storage";

vi.mock("./services/publicationSources", () => ({ resolvePublicationSources: vi.fn().mockResolvedValue([]) }));
vi.mock("./services/keywordSearch", () => ({ fetchArticlesForQuery: vi.fn(() => { throw new Error("Unexpected provider call"); }) }));
vi.mock("node-fetch", () => ({ default: vi.fn(() => { throw new Error("Unexpected network call"); }) }));
const { getEngine } = vi.hoisted(() => ({ getEngine: vi.fn() }));
vi.mock("./services/engines", () => ({ engineRegistry: { getEngine } }));
vi.mock("./services/metaEngine", () => ({ normalizeIndustryToSlug: () => "other" }));
import { BaseIndustryEngine } from "./services/engines/baseEngine";
import type { FetchedArticle } from "./services/engines/types";
import { handleInboxRefresh } from "./jobs/handlers/inbox-refresh";
import type { ArticleQuality } from "@shared/article-quality";
import { publicationDate } from "./services/articleDates";
import { summarizeArticle } from "./services/articleSummary";
import { diversityFeatures } from "./services/inboxDiversity";
import { personalTrends } from "./services/personalTrends";

const qualityFixture = (title: string, origin = "https://publisher.test"): ArticleQuality => ({
  version: "quality-v1", date: publicationDate("2020-01-01T00:00:00Z", "rss-pubDate"),
  freshness: { policy: "balanced-v1", multiplier: 0.6, evaluatedAt: "2026-09-20T12:00:00Z" },
  relevance: { version: "concept-v1", evidence: [{ label: "AI", type: "keyword", weight: 0.7, matchKind: "exact", matchedSurface: "AI", field: "title", span: { start: 0, end: 2 } }] },
  diversity: diversityFeatures(title, origin, ["AI"]), summary: summarizeArticle("Short.").provenance,
});

const tenantIds: string[] = [], userIds: string[] = [];
let scope: TenantScope;
const metrics = { articlesProcessed: 20, articlesMatched: 20, durationMs: 1 };
const candidate = (slug: string): Omit<InsertInboxItem, "tenantId" | "userId"> => ({
  headline: `AI story ${slug}`, source: "Fixture", articleUrl: `https://news.test/${slug}`, relevanceScore: "0.5", status: "active",
});
async function makeScope(existing: Partial<TenantScope> = {}): Promise<TenantScope> {
  const userId = existing.userId ?? randomUUID(), tenantId = existing.tenantId ?? randomUUID();
  if (!existing.userId) { await ownerDb.insert(users).values({ id: userId, email: `${userId}@refresh.test` }); userIds.push(userId); }
  if (!existing.tenantId) { await ownerDb.insert(tenants).values({ id: tenantId, kind: "corporate", name: "Refresh fixture" }); tenantIds.push(tenantId); }
  await ownerDb.insert(tenantMembers).values({ tenantId, userId, role: "member" });
  return { tenantId, userId };
}
async function seed(n: number, status = "active", target = scope, prefix: string = randomUUID()) {
  return ownerDb.insert(inboxItems).values(Array.from({ length: n }, (_, i) => ({
    ...candidate(`${prefix}/${i}`), ...target, status, createdAt: new Date(1000 + i),
  }))).returning();
}
async function refresh(candidates: ReturnType<typeof candidate>[], auto = false, operationId = randomUUID(), target = scope) {
  const begin = await storage.beginInboxRefresh(target, operationId, auto);
  return storage.commitInboxRefresh(target, operationId, auto, begin.snapshot, candidates, metrics);
}
async function active(target = scope) {
  const result = await ownerPool.query("select count(*)::int as n from inbox_items where tenant_id=$1 and user_id=$2 and status='active'", [target.tenantId, target.userId]);
  return result.rows[0].n as number;
}
beforeAll(async () => {
  const target = requireLocalTestDatabase();
  for (const [name, user] of [["DATABASE_URL", "tsp_app"], ["TEST_DATABASE_URL", "tsp_app"],
    ["OWNER_DATABASE_URL", "vivekanandchoudhari"], ["OWNER_TEST_DATABASE_URL", "vivekanandchoudhari"]]) {
    const url = new URL(process.env[name] ?? "invalid:");
    if (url.protocol !== "postgresql:" || Number(url.port) !== target.port
      || url.pathname !== `/${target.database}` || url.username !== user || url.search || url.hash) throw new Error("Explicit isolated test database required");
  }
  expect((await pool.query("select current_user, current_database(), rolbypassrls, rolsuper from pg_roles where rolname=current_user")).rows[0])
    .toEqual({ current_user: "tsp_app", current_database: target.database, rolbypassrls: false, rolsuper: false });
});
beforeEach(async () => { scope = await makeScope(); });
afterEach(async () => {
  vi.restoreAllMocks();
  if (tenantIds.length) {
    await ownerDb.delete(drafts).where(inArray(drafts.tenantId, tenantIds));
    await ownerDb.delete(inboxItems).where(inArray(inboxItems.tenantId, tenantIds));
    await ownerDb.delete(inboxRefreshReceipts).where(inArray(inboxRefreshReceipts.tenantId, tenantIds));
    await ownerDb.delete(userProfiles).where(inArray(userProfiles.tenantId, tenantIds));
    await ownerDb.delete(tenantMembers).where(inArray(tenantMembers.tenantId, tenantIds));
    await ownerDb.delete(tenants).where(inArray(tenants.id, tenantIds));
  }
  if (userIds.length) await ownerDb.delete(users).where(inArray(users.id, userIds));
  tenantIds.length = 0; userIds.length = 0;
});
afterAll(async () => { await pool.end(); await ownerPool.end(); });

describe("atomic inbox storage contract", () => {
  it("keeps historical quality null, owns admission time and hydrates old/new receipts", async () => {
    const [legacy] = await seed(1, "saved");
    expect(legacy).toMatchObject({ publishedAt: null, discoveredAt: null, rankingScore: null, qualityMetadata: null });
    const operation = randomUUID(), before = Date.now();
    const result = await refresh([{ ...candidate("dated"), publishedAt: new Date("2020-01-01"), qualityMetadata: qualityFixture("AI dated"), rankingScore: "0.3",
      discoveredAt: new Date("1990-01-01") } as ReturnType<typeof candidate>], false, operation);
    expect(result.items[0].discoveredAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(result.items[0].publishedAt).toEqual(new Date("2020-01-01"));
    expect(await storage.getInboxRefreshReceipt(scope, operation, false)).toEqual(result);
    const oldResult = { ...result, items: result.items.map(({ publishedAt: _, discoveredAt: __, rankingScore: ___, qualityMetadata: ____, ...item }) => item) };
    const oldOperation = randomUUID();
    await ownerDb.insert(inboxRefreshReceipts).values({ ...scope, operationId: oldOperation, autoRefresh: false, result: oldResult as typeof result });
    expect(await storage.getInboxRefreshReceipt(scope, oldOperation, false)).toEqual(oldResult);
  });

  it("orders numeric persisted ranking before pagination, with legacy relevance fallback", async () => {
    await ownerDb.insert(inboxItems).values([
      { ...scope, ...candidate("high-relevance-old"), relevanceScore: "0.9", rankingScore: "0.54" },
      { ...scope, ...candidate("fresh"), relevanceScore: "0.6", rankingScore: "0.6" },
      { ...scope, ...candidate("legacy"), relevanceScore: "0.58" },
    ]);
    expect((await storage.getInboxItems(scope, { order: "relevance", limit: 2 })).map(r => r.articleUrl)).toEqual([candidate("fresh").articleUrl, candidate("legacy").articleUrl]);
    expect((await storage.getInboxItems(scope, { order: "relevance", limit: 1, offset: 2 }))[0].articleUrl).toBe(candidate("high-relevance-old").articleUrl);
  });

  it("excludes historical copies before diverse membership without spending their story slot", async () => {
    await seed(9);
    await ownerDb.insert(inboxItems).values({ ...scope, ...candidate("historical"), status: "saved" });
    const pool = ["historical", "new-copy", "other"].map(slug => ({ ...candidate(slug), rankingScore: slug === "other" ? "0.2" : "0.5",
      qualityMetadata: qualityFixture(slug === "other" ? "AI other development" : "AI original report") }));
    const result = await refresh(pool);
    expect(result.items.map(r => r.articleUrl)).toEqual([candidate("new-copy").articleUrl]);
    expect(await active()).toBe(10);
  });

  it("queries scoped discovery windows across all statuses beyond 200 without admitting manual rows", async () => {
    const now = new Date("2026-09-20T12:00:00Z"), day = 86400000;
    const colleague = await makeScope({ tenantId: scope.tenantId }), elsewhere = await makeScope({ userId: scope.userId });
    const row = (slug: string, age: number, target = scope) => ({ ...target, ...candidate(slug), discoveredAt: new Date(now.getTime() - age * day), qualityMetadata: qualityFixture(`AI ${slug}`) });
    await ownerDb.insert(inboxItems).values([
      ...Array.from({ length: 620 }, (_, i) => ({ ...row(`window/${i}`, 1), status: ["active", "saved", "dismissed"][i % 3] })),
      row("previous-boundary", 14), row("current-boundary", 7), row("excluded-now", 0), row("excluded-old", 14.01),
      row("other-user", 1, colleague), row("other-tenant", 1, elsewhere),
      { ...row("manual", 1), relevanceScore: "0" }, { ...row("unscored", 1), qualityMetadata: null },
      { ...row("malformed", 1), qualityMetadata: { relevance: { evidence: "not an array" } } as unknown as ArticleQuality },
    ]);
    const rows = await storage.getInboxDiscoveryWindow(scope, now);
    expect(rows).toHaveLength(622);
    expect(personalTrends(rows, now)).toMatchObject([{ count: 621, previousCount: 1, coverage: { partial: false, allStatuses: true } }]);
    expect(await storage.getInboxDiscoveryWindow(colleague, now)).toHaveLength(1);
    expect(await storage.getInboxDiscoveryWindow(elsewhere, now)).toHaveLength(1);
  });

  it("uses a nonunique bounded digest expression index scoped by tenant and user", async () => {
    const result = await ownerPool.query("select indexdef from pg_indexes where schemaname='public' and indexname='idx_inbox_canonical'");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].indexdef).toContain("USING btree (tenant_id, user_id, md5(canonical_url))");
    expect(result.rows[0].indexdef).not.toContain("UNIQUE");
  });

  it("keeps exact URL checks collision-safe in lookup, manual add, batch refresh and reactivation", async () => {
    const [historical, saved] = await ownerDb.insert(inboxItems).values([
      { ...scope, ...candidate("history"), status: "dismissed" },
      { ...scope, ...candidate("reactivate"), status: "saved" },
    ]).returning();
    const client = await pool.connect();
    const query = client.query.bind(client);
    const statements: string[] = [];
    // Fault injection ONLY on this checked-out connection's SELECT statements:
    // collapse all digest comparisons to one bucket, without replacing pg.md5,
    // changing any database function/index, or weakening the exact predicate.
    const querySpy = vi.spyOn(client, "query").mockImplementation(((config: any, ...args: any[]) => {
      if (typeof config?.text === "string" && config.text.startsWith("select") && config.text.includes('md5("inbox_items"."canonical_url")')) {
        statements.push(config.text);
        config = { ...config, text: config.text.replace(/md5\(([^()]*)\)/g, "left(md5($1), 0)") };
      }
      return (query as any)(config, ...args);
    }) as typeof client.query);
    // Keep one connection for all transactions; release the real lease in finally.
    const connectSpy = vi.spyOn(pool, "connect").mockImplementation((async () => ({
      query: client.query.bind(client), release: () => {},
    } as typeof client)) as typeof pool.connect);
    try {
      expect(await storage.getInboxItemByUrl(scope, candidate("missing").articleUrl)).toBeUndefined();
      expect(await storage.getInboxItemByUrl(scope, historical.articleUrl)).toMatchObject({ id: historical.id });
      expect(await storage.addInboxItem(scope, candidate("manual"))).toMatchObject({ alreadyExists: false });
      expect(await storage.addInboxItem(scope, candidate("history"))).toMatchObject({ alreadyExists: true, item: { id: historical.id } });
      expect(await refresh([candidate("history"), candidate("batch")])).toMatchObject({ count: 1, items: [{ articleUrl: candidate("batch").articleUrl }] });
      expect(await storage.updateInboxItem(scope, saved.id, { status: "active" })).toMatchObject({ id: saved.id, status: "active" });
      const [duplicate] = await ownerDb.insert(inboxItems).values({ ...scope, ...candidate("manual?utm_source=copy"), status: "saved" }).returning();
      await expect(storage.updateInboxItem(scope, duplicate.id, { status: "active" })).rejects.toBeInstanceOf(InboxCanonicalConflictError);
      expect(statements).toHaveLength(7);
      for (const statement of statements) {
        expect(statement).toContain('"inbox_items"."tenant_id" =');
        expect(statement).toContain('"inbox_items"."user_id" =');
        expect(statement).toContain('"inbox_items"."canonical_url" in (');
      }
      expect(await active()).toBe(3);
    } finally {
      connectSpy.mockRestore();
      querySpy.mockRestore();
      client.release();
    }
  });

  it("converges on incompressible long legacy URLs across backfill batches and repeat writes without deleting history", async () => {
    const history = await seed(205, "dismissed");
    const url = `https://news.test/long?token=${randomBytes(8192).toString("base64url")}`;
    const [saved, duplicate] = await ownerDb.insert(inboxItems).values([
      { ...scope, ...candidate("long"), articleUrl: `${url}&utm_source=old`, status: "saved" },
      { ...scope, ...candidate("long-copy"), articleUrl: `${url}#copy`, status: "dismissed" },
    ]).returning();
    const [draft] = await ownerDb.insert(drafts).values({ ...scope, inboxItemId: duplicate.id,
      platform: "linkedin", tone: "professional", content: "Keep this reference" }).returning();
    const ownCandidate = { ...candidate("long"), articleUrl: `${url}&fbclid=new` };
    const freshUrl = `https://news.test/fresh?token=${randomBytes(8192).toString("base64url")}`;
    const batch = [ownCandidate, { ...candidate("fresh"), articleUrl: freshUrl }];
    expect(await refresh(batch)).toMatchObject({ count: 1, activeCount: 1 });
    for (let i = 0; i < 3; i++) {
      expect(await refresh(batch)).toMatchObject({ count: 0, activeCount: 1 });
      expect(await storage.addInboxItem(scope, ownCandidate)).toMatchObject({ alreadyExists: true,
        item: { id: expect.stringMatching(`${saved.id}|${duplicate.id}`), canonicalUrl: url } });
      expect(await storage.getInboxItemByUrl(scope, url)).toMatchObject({ canonicalUrl: url });
    }
    const rows = await ownerDb.select().from(inboxItems).where(eq(inboxItems.tenantId, scope.tenantId));
    expect(rows).toHaveLength(history.length + 3);
    expect(rows.filter(row => row.canonicalUrl === null)).toEqual([]);
    expect(rows.find(row => row.id === saved.id)).toEqual({ ...saved, canonicalUrl: url });
    expect(rows.find(row => row.id === duplicate.id)).toEqual({ ...duplicate, canonicalUrl: url });
    expect((await ownerDb.select().from(drafts).where(eq(drafts.id, draft.id)))[0]).toEqual(draft);
    const size = await ownerPool.query("select pg_column_size(canonical_url) as bytes from inbox_items where id=$1", [saved.id]);
    expect(size.rows[0].bytes).toBeGreaterThan(2704);
    const manual = await storage.addInboxItem(scope, { ...candidate("manual-long"), articleUrl: `${freshUrl}&meaningful=1` });
    expect(manual.alreadyExists).toBe(false);
    expect((await storage.addInboxItem(scope, { ...candidate("copy"), articleUrl: `${manual.item.articleUrl}#again` })).item.id).toBe(manual.item.id);
  });

  it.each(["saved", "dismissed"])("rejects canonical-duplicate %s reactivation without altering legacy IDs or references", async status => {
    const [existing, duplicate] = await ownerDb.insert(inboxItems).values([
      { ...scope, ...candidate("same?b=2&a=1"), status: "active" },
      { ...scope, ...candidate("same?b=2&utm_source=legacy&a=1#copy"), status },
    ]).returning();
    const [draft] = await ownerDb.insert(drafts).values({ ...scope, inboxItemId: duplicate.id,
      platform: "linkedin", tone: "professional", content: "Preserved" }).returning();
    await expect(storage.updateInboxItem(scope, duplicate.id, { status: "active" })).rejects.toBeInstanceOf(InboxCanonicalConflictError);
    expect(await storage.getInboxItems(scope)).toEqual(expect.arrayContaining([existing, duplicate]));
    expect((await ownerDb.select().from(drafts).where(eq(drafts.id, draft.id)))[0]).toEqual(draft);
    expect(await active()).toBe(1);
    await storage.updateInboxItem(scope, existing.id, { status: "dismissed" });
    expect(await storage.updateInboxItem(scope, duplicate.id, { status: "active" })).toMatchObject({ id: duplicate.id, status: "active", version: 1 });
  });

  it("serializes concurrent legacy duplicate reactivations and leaves preexisting active duplicates intact", async () => {
    const rows = await ownerDb.insert(inboxItems).values(Array.from({ length: 8 }, (_, i) => ({
      ...scope, ...candidate(`same?utm_source=${i}`), status: i % 2 ? "saved" : "dismissed",
    }))).returning();
    const results = await Promise.allSettled(rows.map(row => storage.updateInboxItem(scope, row.id, { status: "active" })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results) if (result.status === "rejected") expect(result.reason).toBeInstanceOf(InboxCanonicalConflictError);
    expect(await active()).toBe(1);
    expect(await storage.getInboxItems(scope)).toHaveLength(8);
    // Owner maintenance can have left active duplicates. Reads/edits must not reconcile them.
    await ownerDb.update(inboxItems).set({ status: "active" }).where(eq(inboxItems.tenantId, scope.tenantId));
    expect(await storage.updateInboxItem(scope, rows[0].id, { status: "active" })).toMatchObject({ id: rows[0].id, status: "active" });
    expect(await active()).toBe(8);
  });

  it("scopes reactivation duplicate checks by tenant AND user, preserving meaningful query distinctions", async () => {
    const colleague = await makeScope({ tenantId: scope.tenantId }), elsewhere = await makeScope({ userId: scope.userId });
    await storage.createInboxItem(colleague, candidate("same??key=1&x=2&x=1"));
    await storage.createInboxItem(elsewhere, candidate("same??key=1&x=2&x=1"));
    await storage.createInboxItem(scope, candidate("same??key=1&x=1&x=2"));
    const [saved] = await ownerDb.insert(inboxItems).values({ ...scope, ...candidate("same?utm_source=old&?key=1&x=2&x=1"), status: "saved" }).returning();
    expect(await storage.updateInboxItem(scope, saved.id, { status: "active" })).toMatchObject({ id: saved.id, status: "active", canonicalUrl: "https://news.test/same??key=1&x=2&x=1" });
    expect(await active()).toBe(2);
    expect(await storage.getInboxItemByUrl(scope, "https://news.test/same??key=1&x=2&x=1")).toMatchObject({ id: saved.id });
    expect(await storage.updateInboxItem(colleague, saved.id, { status: "active" })).toBeUndefined();
  });

  it("backfills histories beyond 500, dedupes all statuses and preserves duplicate IDs/draft references", async () => {
    const history = await seed(620, "dismissed");
    await ownerDb.update(inboxItems).set({ status: "saved", articleUrl: "https://NEWS.test/Old?b=2&utm_source=old&a=1#saved" }).where(eq(inboxItems.id, history[0].id));
    const [duplicate] = await ownerDb.insert(inboxItems).values({ ...scope, ...candidate("unused"), articleUrl: "https://news.test/Old?b=2&a=1#duplicate", status: "dismissed" }).returning();
    const [draft] = await ownerDb.insert(drafts).values({ ...scope, inboxItemId: duplicate.id, platform: "linkedin", tone: "professional", content: "Kept" }).returning();
    const result = await refresh([{ ...candidate("unused"), articleUrl: "https://news.test/Old?b=2&a=1&fbclid=new" },
      ...history.slice(1, 15).map(row => ({ ...candidate("unused"), articleUrl: `${row.articleUrl}?utm_medium=email#x` })),
      ...Array.from({ length: 12 }, (_, i) => candidate(`fresh/${i}`))]);
    expect(result).toMatchObject({ outcome: "updated", count: 10, replacedCount: 0, activeCount: 10 });
    expect(result.items.map(row => row.articleUrl)).toEqual(Array.from({ length: 10 }, (_, i) => candidate(`fresh/${i}`).articleUrl));
    const rows = await ownerDb.select().from(inboxItems).where(eq(inboxItems.tenantId, scope.tenantId));
    expect(rows).toHaveLength(631);
    expect(rows.filter(row => row.canonicalUrl === null)).toHaveLength(0);
    expect(rows.filter(row => row.canonicalUrl === "https://news.test/Old?b=2&a=1").map(row => row.id).sort()).toEqual([history[0].id, duplicate.id].sort());
    expect(rows.find(row => row.id === history[0].id)?.status).toBe("saved");
    expect((await ownerDb.select().from(drafts).where(eq(drafts.id, draft.id)))[0].inboxItemId).toBe(duplicate.id);
  });

  it("does not merge meaningful query order, path case, slash or scheme", async () => {
    const urls = ["https://news.test/A?a=1&b=2", "https://news.test/A?b=2&a=1", "https://news.test/a?a=1&b=2", "https://news.test/A/?a=1&b=2", "http://news.test/A?a=1&b=2"];
    const result = await refresh(urls.map(articleUrl => ({ ...candidate("x"), articleUrl })));
    expect(result.count).toBe(5);
    expect((await refresh(urls.map(articleUrl => ({ ...candidate("x"), articleUrl: `${articleUrl}&utm_source=copy#x` })))).count).toBe(0);
  });

  it("enforces capacity under 40 concurrent creates, with historical duplicates not consuming slots", async () => {
    const results = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => storage.createInboxItem(scope, candidate(`concurrent/${i}`))));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(10);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(30);
    for (const result of results) if (result.status === "rejected") expect(result.reason).toBeInstanceOf(InboxCapacityError);
    expect(await active()).toBe(10);
    const existing = (await storage.getInboxItems(scope))[0];
    expect((await storage.createInboxItem(scope, { ...candidate("duplicate"), articleUrl: `${existing.articleUrl}?utm_source=new` })).id).toBe(existing.id);
    expect(await active()).toBe(10);
  });

  it("serializes batch, manual create and reactivation under one lock", async () => {
    await seed(8);
    const saved = await seed(8, "saved");
    const work = [refresh(Array.from({ length: 20 }, (_, i) => candidate(`batch/${i}`))),
      ...saved.map(row => storage.updateInboxItem(scope, row.id, { status: "active" })),
      ...Array.from({ length: 10 }, (_, i) => storage.createInboxItem(scope, candidate(`manual/${i}`)))];
    await Promise.allSettled(work);
    expect(await active()).toBe(10);
  });

  it("serializes duplicate concurrent batches and same-canonical manual additions", async () => {
    const candidates = Array.from({ length: 20 }, (_, i) => candidate(`shared/${i}`));
    await Promise.all([refresh(candidates), refresh(candidates),
      ...Array.from({ length: 6 }, () => storage.createInboxItem(scope, candidate("shared/0")))]);
    expect(await active()).toBe(10);
    const rows = await storage.getInboxItems(scope);
    expect(new Set(rows.map(row => row.canonicalUrl)).size).toBe(rows.length);
  });

  it("fills free slots first and replaces only the minimum unchanged snapshot IDs", async () => {
    const old = await seed(8);
    const result = await refresh([candidate("a"), candidate("b"), candidate("c")], true);
    expect(result).toMatchObject({ count: 3, activeCount: 10, replacedCount: 1, outcome: "updated" });
    expect((await storage.getInboxItems(scope)).filter(row => row.status === "dismissed").map(row => row.id)).toEqual([old[0].id]);
  });

  it("preserves saves, new additions and save/reactivate ABA edits made after the snapshot", async () => {
    const old = await seed(10);
    const operationId = randomUUID();
    const begin = await storage.beginInboxRefresh(scope, operationId, true);
    await storage.updateInboxItem(scope, old[0].id, { status: "saved" });
    await storage.updateInboxItem(scope, old[1].id, { status: "saved" });
    await storage.updateInboxItem(scope, old[1].id, { status: "active" });
    const added = await storage.createInboxItem(scope, candidate("manual-new"));
    const result = await storage.commitInboxRefresh(scope, operationId, true, begin.snapshot,
      Array.from({ length: 12 }, (_, i) => candidate(`replace/${i}`)), metrics);
    expect(result).toMatchObject({ count: 8, replacedCount: 8, activeCount: 10 });
    const rows = await storage.getInboxItems(scope);
    expect(rows.find(row => row.id === old[0].id)?.status).toBe("saved");
    expect(rows.find(row => row.id === old[1].id)?.status).toBe("active");
    expect(rows.find(row => row.id === added.id)?.status).toBe("active");
  });

  it.each(["empty", "historical"])("never dismisses an %s candidate refresh", async kind => {
    const old = await seed(10);
    const result = await refresh(kind === "empty" ? [] : old.map(row => ({ ...candidate("x"), articleUrl: `${row.articleUrl}#fragment` })), true);
    expect(result).toMatchObject({ count: 0, replacedCount: 0, activeCount: 10, outcome: "no_new" });
    expect((await storage.getInboxItems(scope)).every(row => row.status === "active" && row.version === 0)).toBe(true);
  });

  it("blocks growth in legacy overcapacity, using SQL count beyond 500 without reconciliation", async () => {
    await seed(510);
    const result = await refresh([candidate("new")], true);
    expect(result).toMatchObject({ outcome: "capacity", activeCount: 510, count: 0, replacedCount: 0 });
    await expect(storage.createInboxItem(scope, candidate("manual"))).rejects.toBeInstanceOf(InboxCapacityError);
    expect(await active()).toBe(510);
  });

  it("rolls back dismissals, inserts, canonical backfill and receipt if any insert fails", async () => {
    const old = await seed(10);
    const operationId = randomUUID();
    const begin = await storage.beginInboxRefresh(scope, operationId, true);
    await expect(storage.commitInboxRefresh(scope, operationId, true, begin.snapshot,
      [candidate("good"), { ...candidate("bad"), headline: null as unknown as string }], metrics)).rejects.toThrow();
    expect(await storage.getInboxRefreshReceipt(scope, operationId, true)).toBeUndefined();
    expect((await storage.getInboxItems(scope)).sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual(old.sort((a, b) => a.id.localeCompare(b.id)));
    expect(await active()).toBe(10);
  });

  it("replays the exact receipt after commit without a second replacement, even after a save or clear", async () => {
    await seed(10);
    const operationId = randomUUID();
    const first = await refresh([candidate("first")], true, operationId);
    await storage.updateInboxItem(scope, first.items[0].id, { status: "saved" });
    const repeated = await refresh([candidate("second")], true, operationId);
    expect(repeated).toEqual(first);
    expect(await active()).toBe(9);
    await storage.clearUserInboxItems(scope);
    expect(await refresh([candidate("third")], true, operationId)).toEqual(first);
    expect(await storage.getInboxItems(scope)).toEqual([]);
    await expect(storage.getInboxRefreshReceipt(scope, operationId, false)).rejects.toBeInstanceOf(InboxOperationConflictError);
  });

  it("serializes same-operation concurrent commits into one receipt", async () => {
    await seed(10);
    const operationId = randomUUID(), begin = await storage.beginInboxRefresh(scope, operationId, true);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => storage.commitInboxRefresh(scope, operationId, true, begin.snapshot, [candidate(`attempt/${i}`)], metrics)));
    for (const result of results) expect(result).toEqual(results[0]);
    expect((await storage.getInboxItems(scope)).filter(row => row.status === "dismissed")).toHaveLength(1);
    expect(await active()).toBe(10);
  });

  it("isolates history, receipt IDs and capacity by both tenant and user and enforces receipt RLS", async () => {
    const colleague = await makeScope({ tenantId: scope.tenantId }), elsewhere = await makeScope({ userId: scope.userId });
    const operationId = randomUUID();
    for (const target of [scope, colleague, elsewhere]) {
      const result = await refresh([candidate("same")], false, operationId, target);
      expect(result.items[0]).toMatchObject(target);
      expect(await active(target)).toBe(1);
    }
    const scoped = await db.transaction(async tx => {
      await tx.execute(sql`select set_config('app.tenant_id', ${scope.tenantId}, true)`);
      return tx.select().from(inboxRefreshReceipts);
    });
    expect(scoped).toHaveLength(2);
    expect(scoped.every(row => row.tenantId === scope.tenantId)).toBe(true);
    expect(await db.select().from(inboxRefreshReceipts)).toEqual([]);
    await expect(db.transaction(async tx => {
      await tx.execute(sql`select set_config('app.tenant_id', ${scope.tenantId}, true)`);
      await tx.insert(inboxRefreshReceipts).values({ ...elsewhere, operationId: randomUUID(), autoRefresh: false, result: (await refresh([], false)) });
    })).rejects.toThrow(/row-level security/i);
  });

  it("bounds candidates and preserves invalid legacy URLs without looping or deleting them", async () => {
    const [invalid] = await ownerDb.insert(inboxItems).values({ ...scope, ...candidate("invalid"), articleUrl: "legacy invalid", status: "saved" }).returning();
    const history = await seed(600, "dismissed", scope, "bounded");
    const result = await refresh([...history.map(row => ({ ...candidate("x"), articleUrl: row.articleUrl })), candidate("outside-bound")]);
    expect(result.count).toBe(0);
    expect((await storage.getInboxItems(scope)).find(row => row.id === invalid.id)?.canonicalUrl).toBe("");
    expect(canonicalHttpUrl(invalid.articleUrl)).toBeNull();
  });

  it("clear and concurrent mixed writes cannot exceed capacity", async () => {
    await seed(10);
    await Promise.allSettled([storage.clearUserInboxItems(scope), refresh(Array.from({ length: 20 }, (_, i) => candidate(`batch/${i}`))),
      ...Array.from({ length: 30 }, (_, i) => storage.createInboxItem(scope, candidate(`manual/${i}`)))]);
    expect(await active()).toBeLessThanOrEqual(10);
  });
});

describe("real engine transaction integration", () => {
  it("takes the version snapshot before fetch, holds no crawl lock, and reads receipt before fetching on retry", async () => {
    const old = await seed(10);
    const profile = await storage.createUserProfile(scope, { keywords: [{ keyword: "AI", weight: 1 }] });
    let release!: () => void, started!: () => void;
    const fetching = new Promise<void>(resolve => { started = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let fetches = 0;
    const engine = new class extends BaseIndustryEngine {
      readonly config = { industry: "other" as const, displayName: "Test", description: "", industryPrompt: "" };
      protected async fetchUserSources(): Promise<FetchedArticle[]> { return []; }
      protected async fetchKeywordSearchArticles(): Promise<FetchedArticle[]> {
        fetches++; started(); await blocked;
        return Array.from({ length: 12 }, (_, i) => ({ title: `AI ${i}`, content: "AI", link: `https://news.test/fetched/${i}`, categories: [], pubDate: "", source: "Test" }));
      }
    }();
    const operationId = randomUUID();
    const task = engine.processForUser(scope, profile, { operationId, autoRefresh: true });
    await fetching;
    // These complete while fetching is BLOCKED: proves no lock is held during crawl.
    await storage.updateInboxItem(scope, old[0].id, { status: "saved" });
    const added = await storage.createInboxItem(scope, candidate("user-new"));
    release();
    const first = await task;
    expect(first).toMatchObject({ success: true, count: 9, replacedCount: 9, activeCount: 10 });
    expect((await storage.getInboxItemByUrl(scope, added.articleUrl))?.status).toBe("active");
    expect((await storage.getInboxItemByUrl(scope, old[0].articleUrl))?.status).toBe("saved");
    expect(await engine.processForUser(scope, profile, { operationId, autoRefresh: true })).toEqual(first);
    await expect(engine.processForUser(scope, profile, { operationId, autoRefresh: false })).rejects.toBeInstanceOf(InboxOperationConflictError);
    expect(fetches).toBe(1);
  });

  it("replays a real committed worker receipt after a progress failure without another fetch or replacement", async () => {
    await seed(10);
    await storage.createUserProfile(scope, { keywords: [{ keyword: "AI", weight: 1 }] });
    let fetches = 0;
    const engine = new class extends BaseIndustryEngine {
      readonly config = { industry: "other" as const, displayName: "Test", description: "", industryPrompt: "" };
      protected async fetchUserSources(): Promise<FetchedArticle[]> { return []; }
      protected async fetchKeywordSearchArticles(): Promise<FetchedArticle[]> {
        fetches++;
        return [{ title: "AI report", content: "AI", link: "https://news.test/worker", categories: [], pubDate: "", source: "Test" }];
      }
    }();
    getEngine.mockReturnValue(engine);
    vi.spyOn(storage, "createEngineRunLog").mockRejectedValue(new Error("Log unavailable"));
    const job = { id: randomUUID(), data: { ...scope, autoRefresh: true, startedAt: Date.now() },
      progress: vi.fn().mockRejectedValueOnce(new Error("Response lost")).mockResolvedValue(undefined) };
    await expect(handleInboxRefresh(job as any)).rejects.toThrow("Refresh committed");
    const committed = await storage.getInboxItems(scope);
    expect(committed.filter(row => row.status === "dismissed")).toHaveLength(1);
    const lookup = vi.spyOn(storage, "getUserProfile");
    const retry = await handleInboxRefresh(job as any);
    expect(retry).toMatchObject({ outcome: "updated", count: 1, replacedCount: 1, activeCount: 10 });
    expect(await storage.getInboxItems(scope)).toEqual(committed);
    expect(lookup).not.toHaveBeenCalled();
    expect(fetches).toBe(1);
  });

  it("a failed awaited fetch writes no receipt and leaves every active item unchanged, allowing retry", async () => {
    const old = await seed(10);
    const profile = await storage.createUserProfile(scope, {});
    let fail = true;
    const engine = new class extends BaseIndustryEngine {
      readonly config = { industry: "other" as const, displayName: "Test", description: "", industryPrompt: "" };
      protected async fetchUserSources(): Promise<FetchedArticle[]> { if (fail) throw new Error("private provider error"); return []; }
      protected async fetchKeywordSearchArticles(): Promise<FetchedArticle[]> { return []; }
    }();
    const operationId = randomUUID();
    const failed = await engine.processForUser(scope, profile, { operationId, autoRefresh: true });
    expect(failed).toMatchObject({ success: false, outcome: "failure", count: 0, replacedCount: 0 });
    expect(JSON.stringify(failed)).not.toContain("private");
    expect(await storage.getInboxRefreshReceipt(scope, operationId, true)).toBeUndefined();
    expect((await storage.getInboxItems(scope)).map(row => row.id).sort()).toEqual(old.map(row => row.id).sort());
    expect(await active()).toBe(10);
    fail = false;
    expect(await engine.processForUser(scope, profile, { operationId, autoRefresh: true })).toMatchObject({ success: true, outcome: "needs_setup", count: 0 });
  });
});