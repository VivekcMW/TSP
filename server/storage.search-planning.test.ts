import { randomUUID } from "node:crypto";
import { requireLocalTestDatabase } from "../test/database-safety";
import express from "express";
import request from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "./db";
import { ownerDb, ownerPool } from "../test/db-owner";
import { userProfiles, users, tenants } from "@shared/schema";
import { planSearchQueries } from "@shared/search-query-plan";
import { searchEditionSchema } from "@shared/search-editions";
import { DatabaseStorage, storage, type TenantScope } from "./storage";

const context = vi.hoisted(() => ({ scope: { tenantId: "", userId: "" } }));
vi.mock("./middlewares/requireDbUser", () => ({
  requireDbUser: (_req: unknown, _res: unknown, next: () => void) => next(),
  authedOf: () => ({ tenant: context.scope, dbUser: { id: context.scope.userId } }),
}));
vi.mock("./middlewares/requirePermission", () => ({ requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("./services/engines/index.js", () => ({ engineRegistry: { getEngine: () => ({ config: { displayName: "Test" } }) } }));
import { registerProfileRoutes } from "./routes/profile";

const app = express();
app.use(express.json());
registerProfileRoutes(app);
const prefix = `search-plan-test-${randomUUID()}`;
const a: TenantScope = { tenantId: `${prefix}-t1`, userId: `${prefix}-u1` };
const b: TenantScope = { tenantId: a.tenantId, userId: `${prefix}-u2` };
const c: TenantScope = { tenantId: `${prefix}-t2`, userId: a.userId };
const tenantIds = [a.tenantId, c.tenantId];
const keywords = Array.from({ length: 20 }, (_, i) => ({ keyword: `keyword${String(i).padStart(2, "0")}`, weight: 1 - i / 20 }));
const selection = { keywords, companies: Array.from({ length: 20 }, (_, i) => `company${i}`), influencers: Array.from({ length: 20 }, (_, i) => `person${i}`) };
const editions = searchEditionSchema.options;
let validatedTarget = false;
const profileWhere = (scope = a) => and(eq(userProfiles.tenantId, scope.tenantId), eq(userProfiles.userId, scope.userId));

beforeAll(async () => {
  const target = requireLocalTestDatabase();
  for (const [name, user] of [["TEST_DATABASE_URL", "tsp_app"], ["OWNER_TEST_DATABASE_URL", "vivekanandchoudhari"]]) {
    const raw = process.env[name];
    if (!raw) throw new Error(`Explicit ${name} required`);
    const url = new URL(raw);
    if (url.username !== user) {
      throw new Error("Search tests require the dedicated local test database and expected roles");
    }
  }
  expect(process.env.DATABASE_URL).toBe(process.env.TEST_DATABASE_URL);
  for (const [connection, user] of [[pool, "tsp_app"], [ownerPool, "vivekanandchoudhari"]] as const) {
    const { rows: [identity] } = await connection.query(`select current_database() as db, current_user as role,
      inet_server_port() as port, inet_server_addr()::text as address, rolsuper, rolbypassrls
      from pg_roles where rolname = current_user`);
    expect(identity).toMatchObject({ db: target.database, role: user, port: target.port });
    expect(["127.0.0.1/32", "::1/128", "127.0.0.1", "::1"]).toContain(identity.address);
    if (user === "tsp_app") expect(identity).toMatchObject({ rolsuper: false, rolbypassrls: false });
  }
  validatedTarget = true;
  await ownerDb.insert(users).values([{ id: a.userId, email: `${prefix}-a@test.invalid` }, { id: b.userId, email: `${prefix}-b@test.invalid` }]);
  await ownerDb.insert(tenants).values(tenantIds.map(id => ({ id, name: id, kind: "personal" })));
});

beforeEach(async () => {
  if (!validatedTarget) throw new Error("Database identity not validated");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External requests forbidden"); }));
  context.scope = a;
  await ownerDb.delete(userProfiles).where(inArray(userProfiles.tenantId, tenantIds));
  for (const scope of [a, b, c]) await storage.createUserProfile(scope, selection);
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => {
  if (validatedTarget) {
    await ownerDb.delete(userProfiles).where(inArray(userProfiles.tenantId, tenantIds));
    await ownerDb.delete(tenants).where(inArray(tenants.id, tenantIds));
    await ownerDb.delete(users).where(inArray(users.id, [a.userId, b.userId]));
  }
  await pool.end(); await ownerPool.end();
});

describe("persisted search planning", () => {
  it("defaults edition/state without changing selections or RLS (read-only schema checks)", async () => {
    const before = await storage.getUserProfile(a);
    expect(before).toMatchObject({ ...selection, searchEdition: "en-US", searchQueryState: {} });
    const { rows: [rls] } = await ownerPool.query("select relrowsecurity, relforcerowsecurity from pg_class where oid = 'user_profiles'::regclass");
    expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const { rows } = await ownerPool.query("select policyname, qual, with_check from pg_policies where tablename = 'user_profiles'");
    expect(rows).toEqual([expect.objectContaining({ policyname: "tenant_isolation", qual: expect.stringContaining("app.tenant_id"), with_check: expect.stringContaining("app.tenant_id") })]);
    expect(await storage.getUserProfile(a)).toEqual(before);
  });

  it("persists the exact next state and returns the complete locked scoring snapshot", async () => {
    const profile = await storage.getUserProfile(a);
    const expected = planSearchQueries(selection);
    expect(await storage.reserveSearchQueryPlan(a)).toEqual({ queries: expected.queries, searchEdition: "en-US", profile });
    expect((await storage.getUserProfile(a))?.searchQueryState).toEqual(expected.state);
    expect(await storage.reserveSearchQueryPlan(a)).toEqual({ queries: planSearchQueries(selection, expected.state).queries, searchEdition: "en-US",
      profile: { ...profile, searchQueryState: expected.state } });
  });

  it("serializes eight simultaneous reservations exactly like eight sequential plans", async () => {
    let state: unknown = {};
    const expected: string[][] = [];
    for (let i = 0; i < 8; i++) {
      const plan = planSearchQueries(selection, state);
      expected.push(plan.queries); state = plan.state;
    }
    const actual = await Promise.all(Array.from({ length: 8 }, () => storage.reserveSearchQueryPlan(a)));
    expect(actual.map(plan => JSON.stringify(plan.queries)).sort()).toEqual(expected.map(queries => JSON.stringify(queries)).sort());
    // Sliding windows intentionally overlap; concurrency must not lose progress.
    expect(new Set(actual.flatMap(plan => plan.queries))).toEqual(new Set(expected.flat()));
    expect((await storage.getUserProfile(a))?.searchQueryState).toEqual(state);
  });

  it.each([8, 16, 20].flatMap(count => [1, 3].map(groups => ({ count, groups }))))
    ("persists dispatch progress despite failed prefixes: $count terms x $groups groups", async ({ count, groups }) => {
      const signals = { keywords: keywords.slice(0, count), companies: groups === 3 ? selection.companies.slice(0, count) : [],
        influencers: groups === 3 ? selection.influencers.slice(0, count) : [] };
      await storage.updateUserProfile(a, signals);
      const eligible = new Set([...signals.keywords.map(term => term.keyword), ...signals.companies, ...signals.influencers]);
      const prefixes = [1, 2, 4, 6].map(size => ({ size, attempted: new Set<string>() }));
      let state: unknown = {};
      for (let run = 0; run < eligible.size && prefixes.some(prefix => prefix.attempted.size < eligible.size); run++) {
        // New repository instance every time: no in-memory progress and no
        // success acknowledgement. Only the prefix actually starts before abort.
        const reservation = await new DatabaseStorage().reserveSearchQueryPlan(a);
        const expected = planSearchQueries(signals, state);
        expect(reservation.queries).toEqual(expected.queries);
        expect(reservation.profile.searchQueryState).toEqual(state);
        for (const prefix of prefixes) reservation.queries.slice(0, prefix.size).forEach(query => prefix.attempted.add(query));
        state = expected.state;
        expect((await storage.getUserProfile(a))?.searchQueryState).toEqual(state);
      }
      for (const prefix of prefixes) expect(prefix.attempted).toEqual(eligible);
    });

  it.each([1, 2])("upgrades persisted version %i by resetting all server-owned progress", async version => {
    const old = { ...planSearchQueries(selection).state, version, cursors: [19, 10, 5], groupStart: 2 };
    await ownerPool.query("update user_profiles set search_query_state = $3 where tenant_id = $1 and user_id = $2",
      [a.tenantId, a.userId, JSON.stringify(version === 2 ? { ...old, dispatchOffset: 59 } : old)]);
    const expected = planSearchQueries(selection);
    expect((await storage.reserveSearchQueryPlan(a)).queries).toEqual(expected.queries);
    expect((await storage.getUserProfile(a))?.searchQueryState).toEqual(expected.state);
    expect((await storage.reserveSearchQueryPlan(a)).queries).toEqual(planSearchQueries(selection, expected.state).queries);
  });

  it("reads changed signals AND edition only after acquiring the current profile lock", async () => {
    await storage.reserveSearchQueryPlan(a);
    const connection = await ownerPool.connect();
    let reservation: ReturnType<typeof storage.reserveSearchQueryPlan> | undefined;
    try {
      await connection.query("BEGIN");
      await connection.query(`update user_profiles set keywords = $3, companies = $4, influencers = $5, search_edition = 'hi-IN', publications = '["Current publication"]'::jsonb
        where tenant_id = $1 and user_id = $2`, [a.tenantId, a.userId,
        JSON.stringify([{ keyword: "Disabled", weight: 0 }, { keyword: "Fresh", weight: 0.1 }]), JSON.stringify(["Disabled"]), JSON.stringify(["Person"])]);
      reservation = storage.reserveSearchQueryPlan(a);
      await vi.waitFor(async () => {
        const { rows } = await pool.query(`select pid from pg_stat_activity where datname = current_database()
          and usename = 'tsp_app' and wait_event_type = 'Lock' and query like '%user_profiles%'`);
        expect(rows.length).toBeGreaterThan(0);
      });
      await connection.query("COMMIT");
      const reserved = await reservation;
      expect(reserved).toMatchObject({ queries: ["Fresh", "Disabled", "Person"], searchEdition: "hi-IN", profile: {
        ...a, searchEdition: "hi-IN", publications: ["Current publication"],
        keywords: [{ keyword: "Disabled", weight: 0 }, { keyword: "Fresh", weight: 0.1 }], companies: ["Disabled"], influencers: ["Person"],
      } });
      const snapshot = structuredClone(reserved.profile);
      await storage.updateUserProfile(a, { keywords: [{ keyword: "Later", weight: 1 }], publications: ["Later publication"], searchEdition: "en-GB" });
      expect(reserved.profile).toEqual(snapshot);
      reserved.profile.keywords![0].weight = 1;
      reserved.profile.companies!.push("Forged");
      const current = await storage.getUserProfile(a);
      expect(current).toMatchObject({ keywords: [{ keyword: "Later", weight: 1 }], publications: ["Later publication"], companies: ["Disabled"], searchEdition: "en-GB" });
    } finally { await connection.query("ROLLBACK"); connection.release(); await reservation; }
  });

  it("isolates both different users in one tenant and the same user across tenants", async () => {
    const first = await storage.reserveSearchQueryPlan(a);
    for (const scope of [b, c]) expect((await storage.getUserProfile(scope))?.searchQueryState).toEqual({});
    await storage.reserveSearchQueryPlan(a);
    for (const scope of [b, c]) {
      const reserved = await storage.reserveSearchQueryPlan(scope);
      expect(reserved).toMatchObject({ queries: first.queries, searchEdition: first.searchEdition, profile: { ...scope, ...selection } });
      expect(reserved.profile.id).not.toBe(first.profile.id);
    }
    expect((await storage.getUserProfile(a))?.searchQueryState).not.toEqual((await storage.getUserProfile(b))?.searchQueryState);
  });

  it("does not expose profiles without RLS context and rejects cross-tenant writes", async () => {
    expect(await db.select().from(userProfiles)).toEqual([]);
    await expect(db.transaction(async tx => {
      await tx.execute(sql`select set_config('app.tenant_id', ${a.tenantId}, true)`);
      await tx.insert(userProfiles).values({ ...c, userId: b.userId });
    })).rejects.toThrow(/row-level security/i);
  });

  it("throws on a missing profile without creating a row or using head queries", async () => {
    await ownerDb.delete(userProfiles).where(profileWhere());
    await expect(storage.reserveSearchQueryPlan(a)).rejects.toThrow("Profile not found");
    expect(await storage.getUserProfile(a)).toBeUndefined();
    expect((await storage.getUserProfile(b))?.searchQueryState).toEqual({});
  });

  it("prevents storage callers and HTTP clients from overwriting server-owned state", async () => {
    await storage.reserveSearchQueryPlan(a);
    const before = (await storage.getUserProfile(a))!.searchQueryState;
    await storage.updateUserProfile(a, { searchQueryState: {}, focusDescription: "A valid focus description" });
    expect((await storage.getUserProfile(a))?.searchQueryState).toEqual(before);
    const response = await request(app).patch("/api/profile").send({ searchQueryState: { version: 9, cursors: [999, 999, 999] }, search_query_state: {}, timezone: "UTC" });
    expect(response.status).toBe(200);
    expect((await storage.getUserProfile(a))?.searchQueryState).toEqual(before);
    expect((await storage.reserveSearchQueryPlan(a)).queries).toEqual(planSearchQueries(selection, before).queries);
  });

  it("ignores forged initial cursor state during profile creation", async () => {
    await ownerDb.delete(userProfiles).where(profileWhere());
    const created = await storage.createUserProfile(a, { ...selection, searchQueryState: planSearchQueries(selection).state });
    expect(created.searchQueryState).toEqual({});
    expect((await storage.reserveSearchQueryPlan(a)).queries).toEqual(planSearchQueries(selection).queries);
  });

  it("continues after reordered selection updates but resets after real edits", async () => {
    await storage.reserveSearchQueryPlan(a);
    const before = (await storage.getUserProfile(a))!.searchQueryState;
    await storage.updateUserProfile(a, { keywords: [...keywords].reverse() });
    expect((await storage.reserveSearchQueryPlan(a)).queries).toEqual(planSearchQueries(selection, before).queries);
    const edited = { ...selection, keywords: keywords.map(term => ({ ...term, weight: term.keyword === "keyword19" ? 1 : 0 })) };
    await storage.updateUserProfile(a, { keywords: edited.keywords });
    expect((await storage.reserveSearchQueryPlan(a)).queries).toEqual(planSearchQueries(edited).queries);
  });

  it("repairs malformed persisted object state and fails closed for invalid stored signals", async () => {
    await ownerPool.query("update user_profiles set search_query_state = $3 where tenant_id = $1 and user_id = $2",
      [a.tenantId, a.userId, JSON.stringify({ ...planSearchQueries(selection).state, cursors: [null, "NaN", -1] })]);
    expect((await storage.reserveSearchQueryPlan(a)).queries).toEqual(planSearchQueries(selection).queries);
    await ownerPool.query("update user_profiles set keywords = $3 where tenant_id = $1 and user_id = $2", [a.tenantId, a.userId, JSON.stringify([{ keyword: "Bad", weight: "0.7" }])]);
    expect(await storage.reserveSearchQueryPlan(a)).toMatchObject({ queries: [], searchEdition: "en-US", profile: { ...a, keywords: [{ keyword: "Bad", weight: "0.7" }] } });
    expect((await storage.getUserProfile(a))?.searchQueryState).toEqual(planSearchQueries({ keywords: [" "] }).state);
  });

  it("reserves empty selections without inventing head queries", async () => {
    await storage.updateUserProfile(a, { keywords: [], companies: [], influencers: [] });
    expect(await storage.reserveSearchQueryPlan(a)).toMatchObject({ queries: [], searchEdition: "en-US", profile: { ...a, keywords: [], companies: [], influencers: [] } });
  });

  it.each(editions)("accepts exactly supported edition %s on update and create", async searchEdition => {
    await storage.updateUserProfile(a, { searchEdition });
    expect((await storage.reserveSearchQueryPlan(a)).searchEdition).toBe(searchEdition);
    await ownerDb.delete(userProfiles).where(profileWhere(b));
    expect((await storage.createUserProfile(b, { searchEdition })).searchEdition).toBe(searchEdition);
  });

  it.each(["en-us", " en-US", "en-US ", "xx-XX", "", null, 42])("rejects invalid edition (%s) without partial profile changes", async invalid => {
    const before = await storage.getUserProfile(a);
    await expect(storage.updateUserProfile(a, { searchEdition: invalid as string, companies: ["Changed"] })).rejects.toThrow();
    expect(await storage.getUserProfile(a)).toEqual(before);
    await ownerDb.delete(userProfiles).where(profileWhere(b));
    await expect(storage.createUserProfile(b, { searchEdition: invalid as string })).rejects.toThrow();
    expect(await storage.getUserProfile(b)).toBeUndefined();
  });

  it("enforces non-null, edition and JSON-object database constraints", async () => {
    for (const value of ["[]", "null", "42", '"string"']) {
      await expect(ownerPool.query("update user_profiles set search_query_state = $3::jsonb where tenant_id = $1 and user_id = $2", [a.tenantId, a.userId, value])).rejects.toThrow(/check constraint/i);
    }
    await expect(ownerPool.query("update user_profiles set search_query_state = NULL where tenant_id = $1 and user_id = $2", [a.tenantId, a.userId])).rejects.toThrow(/not-null/i);
    await expect(ownerPool.query("update user_profiles set search_edition = NULL where tenant_id = $1 and user_id = $2", [a.tenantId, a.userId])).rejects.toThrow(/not-null/i);
    await expect(ownerPool.query("update user_profiles set search_edition = 'xx-XX' where tenant_id = $1 and user_id = $2", [a.tenantId, a.userId])).rejects.toThrow(/check constraint/i);
  });
});