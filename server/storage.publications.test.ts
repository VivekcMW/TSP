import { randomUUID } from "node:crypto";
import { requireLocalTestDatabase } from "../test/database-safety";
import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "./db";
import { ownerDb, ownerPool } from "../test/db-owner";
import { publicationResolutions, userSourceDeletions, userProfiles, userSources, users, tenants } from "@shared/schema";
import { storage, type TenantScope } from "./storage";
import { getPublicationSourceStatuses } from "./services/publicationSources";

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
const prefix = `publication-test-${randomUUID()}`;
const a: TenantScope = { tenantId: `${prefix}-t1`, userId: `${prefix}-u1` };
const b: TenantScope = { tenantId: a.tenantId, userId: `${prefix}-u2` };
const c: TenantScope = { tenantId: `${prefix}-t2`, userId: a.userId };
const tenantIds = [a.tenantId, c.tenantId];
const candidate = { name: "Research", url: "https://research.test/" };
const second = { name: "Other", url: "https://other.test/" };
const source = { name: "Research feed", feedUrl: "https://research.test/feed", sourceType: "feed" as const };
let validatedTarget = false;

function resolutionWhere(scope = a, url = candidate.url) {
  return and(eq(publicationResolutions.tenantId, scope.tenantId), eq(publicationResolutions.userId, scope.userId), eq(publicationResolutions.url, url));
}

async function resolutions(scope = a, urls = [candidate.url]) {
  return storage.getPublicationResolutions(scope, urls);
}

async function deletions(scope = a) {
  return ownerDb.select().from(userSourceDeletions).where(and(
    eq(userSourceDeletions.tenantId, scope.tenantId), eq(userSourceDeletions.userId, scope.userId),
  )).orderBy(userSourceDeletions.feedUrl);
}

async function claim(scope = a, url = candidate.url) {
  const token = await storage.claimPublicationResolution(scope, url);
  expect(token).toEqual(expect.any(String));
  return token!;
}

async function expire() {
  await ownerDb.update(publicationResolutions).set({ leaseUntil: new Date(0) }).where(resolutionWhere());
}

beforeAll(async () => {
  const target = requireLocalTestDatabase();
  // Fail before any fixture write; never rely on implicit test/setup fallbacks.
  for (const [key, user] of [["TEST_DATABASE_URL", "tsp_app"], ["OWNER_TEST_DATABASE_URL", "vivekanandchoudhari"]]) {
    const value = process.env[key];
    if (!value) throw new Error(`Explicit ${key} is required for publication persistence tests`);
    const url = new URL(value);
    if (url.username !== user) {
      throw new Error("Publication tests require the dedicated local test database and expected role");
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
  if (!validatedTarget) throw new Error("Database target not validated");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External requests forbidden"); }));
  context.scope = a;
  await ownerDb.delete(userSources).where(inArray(userSources.tenantId, tenantIds));
  await ownerDb.delete(userSourceDeletions).where(inArray(userSourceDeletions.tenantId, tenantIds));
  await ownerDb.delete(userProfiles).where(inArray(userProfiles.tenantId, tenantIds));
  for (const scope of [a, b, c]) {
    await storage.createUserProfile(scope, { publications: [candidate.name, second.name], publicationCandidates: [candidate, second] });
  }
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (validatedTarget) {
    await ownerDb.delete(userSources).where(inArray(userSources.tenantId, tenantIds));
    await ownerDb.delete(userProfiles).where(inArray(userProfiles.tenantId, tenantIds));
    await ownerDb.delete(tenants).where(inArray(tenants.id, tenantIds));
    await ownerDb.delete(users).where(inArray(users.id, [a.userId, b.userId]));
  }
  await pool.end();
  await ownerPool.end();
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("publication persistence and migration", () => {
  it("applies canonical deletion migration idempotently and enforces FORCE RLS", async () => {
    const existing = await storage.createUserSource(a, source);
    await storage.deleteUserSource(a, existing.id);
    const before = await deletions();
    expect(before).toEqual([expect.objectContaining({ ...a, feedUrl: source.feedUrl, sourceId: existing.id })]);
    const connection = await ownerPool.connect();
    try {
      await connection.query("BEGIN");
      const migration = readFileSync(new URL("../migrations/0025_user_source_deletions.sql", import.meta.url), "utf8");
      await connection.query(migration);
      await connection.query(migration);
      const { rows: [rls] } = await connection.query(`select relrowsecurity, relforcerowsecurity
        from pg_class where oid = 'user_source_deletions'::regclass`);
      expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const { rows: policies } = await connection.query(`select policyname, qual, with_check
        from pg_policies where tablename = 'user_source_deletions'`);
      expect(policies).toEqual([expect.objectContaining({ policyname: "tenant_isolation",
        qual: expect.stringContaining("app.tenant_id"), with_check: expect.stringContaining("app.tenant_id") })]);
      await connection.query("COMMIT");
    } finally { await connection.query("ROLLBACK"); connection.release(); }
    expect(await deletions()).toEqual(before);
    const other = await storage.createUserSource(c, source);
    await storage.deleteUserSource(c, other.id);
    expect(await db.select().from(userSourceDeletions)).toEqual([]);
    await db.transaction(async tx => {
      await tx.execute(sql`select set_config('app.tenant_id', ${a.tenantId}, true)`);
      expect(await tx.select().from(userSourceDeletions)).toEqual(before);
      await tx.delete(userSourceDeletions);
    });
    expect(await deletions()).toEqual([]);
    expect(await deletions(c)).toHaveLength(1);
    await expect(db.transaction(async tx => {
      await tx.execute(sql`select set_config('app.tenant_id', ${a.tenantId}, true)`);
      await tx.insert(userSourceDeletions).values({ ...c, feedUrl: second.url, sourceId: "forged" });
    })).rejects.toThrow(/row-level security/i);
  });

  it("applies idempotently, enables FORCE RLS and defaults metadata without rewriting names", async () => {
    const connection = await ownerPool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query(readFileSync(new URL("../migrations/0024_publication_source_lifecycle.sql", import.meta.url), "utf8"));
      const { rows: [rls] } = await connection.query(`select relrowsecurity, relforcerowsecurity from pg_class where oid = 'publication_resolutions'::regclass`);
      expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const { rows } = await connection.query(`select policyname, qual, with_check from pg_policies where tablename = 'publication_resolutions'`);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ policyname: "tenant_isolation", qual: expect.stringContaining("app.tenant_id"), with_check: expect.stringContaining("app.tenant_id") });
      await connection.query("ROLLBACK");
    } finally { await connection.query("ROLLBACK"); connection.release(); }
    await ownerDb.delete(userProfiles).where(and(eq(userProfiles.tenantId, b.tenantId), eq(userProfiles.userId, b.userId)));
    const profile = await storage.createUserProfile(b, { publications: ["Legacy name"] });
    expect(profile.publicationCandidates).toEqual([]);
    expect(profile.publications).toEqual(["Legacy name"]);
  });

  it("isolates users in a tenant and the same user across tenants in every lifecycle method", async () => {
    const token = await claim();
    for (const scope of [b, c]) {
      expect(await resolutions(scope)).toEqual([]);
      expect(await storage.finishPublicationResolution(scope, candidate.url, token, { status: "failed" })).toBe(false);
      expect(await storage.completePublicationResolution(scope, candidate.url, token, source)).toBe(false);
      const otherToken = await claim(scope);
      expect(otherToken).not.toBe(token);
      expect(await storage.finishPublicationResolution(scope, candidate.url, otherToken, { status: "failed" })).toBe(true);
    }
    expect((await resolutions())[0]).toMatchObject({ status: "checking", claimToken: token });
    expect(await storage.getUserSources(a)).toEqual([]);
  });

  it("backfills only exact scoped live references idempotently without changing attempt times or legacy missing rows", async () => {
    const connection = await ownerPool.connect();
    const attemptTime = new Date("2020-01-01T00:00:00Z");
    const live = await storage.createUserSource(a, source);
    const foreign = await storage.createUserSource(b, { ...source, feedUrl: `${source.feedUrl}/foreign` });
    const otherTenant = await storage.createUserSource(c, source);
    try {
      await connection.query("BEGIN");
      for (const [url, sourceId, status] of [[candidate.url, live.id, "resolved"], [second.url, foreign.id, "resolved"],
        ["https://other-tenant.test/", otherTenant.id, "resolved"],
        ["https://missing.test/", "deleted-id", "resolved"], ["https://failed.test/", live.id, "failed"]]) {
        await connection.query(`insert into publication_resolutions
          (tenant_id, user_id, url, status, last_attempt_at, source_id) values ($1, $2, $3, $4, $5, $6)`,
        [a.tenantId, a.userId, url, status, attemptTime, sourceId]);
      }
      const migration = readFileSync(new URL("../migrations/0024_publication_source_lifecycle.sql", import.meta.url), "utf8");
      await connection.query(migration);
      const query = "select * from publication_resolutions where tenant_id = $1 and user_id = $2 order by url";
      const { rows: first } = await connection.query(query, [a.tenantId, a.userId]);
      expect(first.find(row => row.url === candidate.url)?.resolved_feed_url).toBe(source.feedUrl);
      expect(first.filter(row => row.url !== candidate.url).every(row => row.resolved_feed_url === null)).toBe(true);
      expect(first.every(row => row.last_attempt_at.getTime() === attemptTime.getTime())).toBe(true);
      // A recorded canonical identity must not be overwritten by later source edits.
      await connection.query("update user_sources set feed_url = $1 where id = $2", ["https://changed.test/feed", live.id]);
      await connection.query(migration);
      expect((await connection.query(query, [a.tenantId, a.userId])).rows).toEqual(first);
    } finally { await connection.query("ROLLBACK"); connection.release(); }
  });

  it.each(["replace", "remove"])("pauses only the old publication-created source on %s and never reactivates on reselection", async change => {
    for (const scope of [a, b, c]) await storage.completePublicationResolution(scope, candidate.url, await claim(scope), source);
    const [before] = await resolutions();
    if (change === "replace") await storage.updateUserProfile(a, { publicationCandidates: [{ ...candidate, url: "https://replacement.test/" }, second] });
    else await storage.updateUserProfile(a, { publications: [second.name] });
    expect((await storage.getUserSources(a))[0]).toMatchObject({ id: before.sourceId, isActive: false, addedVia: "publication" });
    expect((await storage.getUserSources(b))[0].isActive).toBe(true);
    expect((await storage.getUserSources(c))[0].isActive).toBe(true);
    expect(await resolutions()).toEqual([before]);
    await storage.updateUserProfile(a, { publications: [candidate.name], publicationCandidates: [candidate] });
    expect((await storage.getUserSources(a))[0].isActive).toBe(false);
    expect(await storage.claimPublicationResolution(a, candidate.url)).toBeUndefined();
    expect(await getPublicationSourceStatuses(a)).toMatchObject([{ name: candidate.name, status: "paused" }]);
  });

  it.each(["resolved-alias", "explicit-feed", "legacy-feed"])("keeps the shared canonical source active for a selected %s", async alias => {
    await storage.completePublicationResolution(a, candidate.url, await claim(), source);
    if (alias === "resolved-alias") {
      await storage.completePublicationResolution(a, second.url, await claim(a, second.url), source);
      await storage.updateUserProfile(a, { publications: [second.name] });
    } else if (alias === "explicit-feed") {
      await storage.updateUserProfile(a, { publications: [second.name], publicationCandidates: [{ ...second, url: source.feedUrl }] });
    } else await storage.updateUserProfile(a, { publications: [source.feedUrl] });
    expect((await storage.getUserSources(a))[0].isActive).toBe(true);
    await storage.updateUserProfile(a, { publications: [] });
    expect((await storage.getUserSources(a))[0].isActive).toBe(false);
  });

  it.each(["manual", "suggestion"])("never pauses a %s-created source linked by publication discovery", async addedVia => {
    const existing = await storage.createUserSource(a, { ...source, addedVia });
    await storage.completePublicationResolution(a, candidate.url, await claim(), source);
    await storage.updateUserProfile(a, { publications: [] });
    expect(await storage.getUserSources(a)).toEqual([existing]);
  });

  it.each(["manual", "suggestion"])("repairs only same-scope exact canonical tombstones on explicit %s reconnect", async addedVia => {
    const original = new Map<string, Awaited<ReturnType<typeof resolutions>>[number]>();
    for (const scope of [a, b, c]) {
      await storage.completePublicationResolution(scope, candidate.url, await claim(scope), source);
      const [row] = await resolutions(scope);
      original.set(`${scope.tenantId}/${scope.userId}`, row);
      expect(row.resolvedFeedUrl).toBe(source.feedUrl);
      await storage.deleteUserSource(scope, row.sourceId!);
    }
    // Neither the publication's input URL, a same-host URL, nor the name suffices.
    await storage.createUserSource(a, { ...source, name: candidate.name, feedUrl: candidate.url });
    expect((await getPublicationSourceStatuses(a))[0].status).toBe("removed");
    expect((await resolutions())[0]).toEqual(original.get(`${a.tenantId}/${a.userId}`));
    const replacement = await storage.createUserSource(a, { ...source, name: "Different label", addedVia, isActive: false });
    expect((await resolutions())[0]).toEqual({ ...original.get(`${a.tenantId}/${a.userId}`), sourceId: replacement.id });
    for (const scope of [b, c]) expect((await resolutions(scope))[0]).toEqual(original.get(`${scope.tenantId}/${scope.userId}`));
    expect((await getPublicationSourceStatuses(a))[0]).toMatchObject({ status: "paused", sourceId: replacement.id });
    await storage.updateUserSource(a, replacement.id, { isActive: true });
    expect((await getPublicationSourceStatuses(a))[0]).toMatchObject({ status: "connected", sourceId: replacement.id });
    await storage.updateUserProfile(a, { publications: [] });
    expect((await storage.getUserSources(a)).find(row => row.id === replacement.id)?.isActive).toBe(true);
  });

  it("leaves unknown legacy tombstones removed and does not repair from status reads", async () => {
    const lastAttemptAt = new Date("2020-01-01T00:00:00Z");
    await ownerDb.insert(publicationResolutions).values({ ...a, url: candidate.url,
      status: "resolved", sourceId: "legacy-deleted", lastAttemptAt });
    await storage.createUserSource(a, { ...source, feedUrl: candidate.url });
    const [before] = await resolutions();
    const statuses = await getPublicationSourceStatuses(a);
    expect(statuses[0]).toMatchObject({ status: "removed", lastAttemptAt: lastAttemptAt.toISOString() });
    expect(statuses[0].message).toContain("cannot be restored automatically");
    expect(await resolutions()).toEqual([before]);
  });

  it("does not let automatic alias completion repair or recreate a known removed canonical feed", async () => {
    await storage.completePublicationResolution(a, candidate.url, await claim(), source);
    const [before] = await resolutions();
    await storage.deleteUserSource(a, before.sourceId!);
    await storage.completePublicationResolution(a, second.url, await claim(a, second.url), source);
    expect(await storage.getUserSources(a)).toEqual([]);
    expect((await resolutions(a, [second.url]))[0]).toMatchObject({ status: "resolved", sourceId: before.sourceId, resolvedFeedUrl: source.feedUrl });
    const readded = await storage.createUserSource(a, source);
    expect((await resolutions(a, [candidate.url, second.url])).every(row => row.sourceId === readded.id)).toBe(true);
  });

  it.each(["before any claim", "during a claim"])("retains manual deletion %s across fresh discovery and canonical aliases", async timing => {
    const existing = await storage.createUserSource(a, { ...source, isActive: false });
    const stale = timing === "during a claim" ? await claim() : undefined;
    const before = await resolutions();
    await storage.deleteUserSource(a, existing.id);
    const marker = await deletions();
    expect(marker).toEqual([expect.objectContaining({ ...a, feedUrl: source.feedUrl, sourceId: existing.id })]);
    if (stale) {
      expect((await resolutions())[0]).toMatchObject({ status: "failed", lastAttemptAt: before[0].lastAttemptAt });
      expect(await storage.completePublicationResolution(a, candidate.url, stale, source)).toBe(false);
    }
    const fresh = await claim();
    expect(fresh).not.toBe(stale);
    expect(await storage.completePublicationResolution(a, candidate.url, fresh, source)).toBe(true);
    expect(await storage.completePublicationResolution(a, second.url, await claim(a, second.url), source)).toBe(true);
    expect(await storage.getUserSources(a)).toEqual([]);
    const removed = await resolutions(a, [candidate.url, second.url]);
    expect(removed).toHaveLength(2);
    for (const row of removed) expect(row).toMatchObject({ status: "resolved", sourceId: existing.id,
      resolvedFeedUrl: source.feedUrl, claimToken: null, leaseUntil: null, error: null });
    for (const url of [candidate.url, second.url]) expect(await storage.claimPublicationResolution(a, url)).toBeUndefined();
    // The same projection used by GET must not repair, retry, or mutate anything.
    expect((await getPublicationSourceStatuses(a)).map(row => row.status)).toEqual(["removed", "removed"]);
    expect(await resolutions(a, [candidate.url, second.url])).toEqual(removed);
    expect(await storage.getUserSources(a)).toEqual([]);
    expect(await deletions()).toEqual(marker);
  });

  it("scopes pre-resolution deletion to both tenant and user without suppressing unrelated feeds", async () => {
    const existing = await storage.createUserSource(a, source);
    for (const scope of [b, c]) await storage.deleteUserSource(scope, existing.id);
    expect(await storage.getUserSources(a)).toEqual([existing]);
    await storage.deleteUserSource(a, existing.id);
    for (const scope of [b, c]) {
      expect(await storage.completePublicationResolution(scope, candidate.url, await claim(scope), source)).toBe(true);
      expect((await storage.getUserSources(scope))[0]).toMatchObject({ feedUrl: source.feedUrl, isActive: true });
    }
    expect(await storage.completePublicationResolution(a, candidate.url, await claim(), source)).toBe(true);
    expect(await storage.getUserSources(a)).toEqual([]);
    const unrelated = { ...source, feedUrl: `${source.feedUrl}/unrelated` };
    expect(await storage.completePublicationResolution(a, second.url, await claim(a, second.url), unrelated)).toBe(true);
    expect(await storage.getUserSources(a)).toEqual([expect.objectContaining({ feedUrl: unrelated.feedUrl, isActive: true })]);
  });

  it.each(["manual", "suggestion"])("clears pre-resolution deletion only on exact scoped explicit %s reconnect", async addedVia => {
    for (const scope of [a, b, c]) {
      const existing = await storage.createUserSource(scope, source);
      await storage.deleteUserSource(scope, existing.id);
    }
    // Reconnecting an input alias is not reconnecting the deleted canonical feed.
    const aliasSource = await storage.createUserSource(a, { ...source, feedUrl: candidate.url, addedVia });
    expect(await deletions()).toHaveLength(1);
    await storage.completePublicationResolution(a, candidate.url, await claim(), source);
    expect((await getPublicationSourceStatuses(a))[0].status).toBe("removed");
    const [before] = await resolutions();
    const replacement = await storage.createUserSource(a, { ...source, name: "Explicit paused feed", addedVia, isActive: false });
    expect(await deletions()).toEqual([]);
    expect((await resolutions())[0]).toEqual({ ...before, sourceId: replacement.id });
    // A fresh alias must now link the paused manual row, not a stale deletion marker.
    await storage.completePublicationResolution(a, second.url, await claim(a, second.url), source);
    expect((await getPublicationSourceStatuses(a)).map(row => row.status)).toEqual(["paused", "paused"]);
    expect((await storage.getUserSources(a)).find(row => row.id === replacement.id)).toEqual(replacement);
    for (const scope of [b, c]) {
      expect(await deletions(scope)).toHaveLength(1);
      await storage.completePublicationResolution(scope, candidate.url, await claim(scope), source);
      expect(await storage.getUserSources(scope)).toEqual([]);
      expect((await getPublicationSourceStatuses(scope))[0].status).toBe("removed");
    }
    await storage.updateUserProfile(a, { publications: [] });
    expect((await storage.getUserSources(a)).find(row => row.id === aliasSource.id)).toEqual(aliasSource);
    expect((await storage.getUserSources(a)).find(row => row.id === replacement.id)).toEqual(replacement);
  });

  it("allows explicit reconnect before any resolution and records a subsequent deletion again", async () => {
    const original = await storage.createUserSource(a, source);
    await storage.deleteUserSource(a, original.id);
    const replacement = await storage.createUserSource(a, { ...source, isActive: false });
    await storage.completePublicationResolution(a, candidate.url, await claim(), source);
    expect(await storage.getUserSources(a)).toEqual([replacement]);
    expect((await getPublicationSourceStatuses(a))[0].status).toBe("paused");
    await storage.deleteUserSource(a, replacement.id);
    await storage.completePublicationResolution(a, second.url, await claim(a, second.url), source);
    expect(await storage.getUserSources(a)).toEqual([]);
    expect((await resolutions(a, [second.url]))[0].sourceId).toBe(replacement.id);
  });

  it("preserves deletion when its canonical URL is already an input resolved to another feed", async () => {
    await storage.updateUserProfile(a, { publications: [candidate.name, second.name, source.feedUrl] });
    const otherFeed = { ...source, feedUrl: "https://different.test/feed" };
    await storage.completePublicationResolution(a, source.feedUrl, await claim(a, source.feedUrl), otherFeed);
    const [existingResolution] = await resolutions(a, [source.feedUrl]);
    const manual = await storage.createUserSource(a, source);
    await storage.deleteUserSource(a, manual.id);
    expect(await resolutions(a, [source.feedUrl])).toEqual([existingResolution]);
    await storage.completePublicationResolution(a, candidate.url, await claim(), source);
    expect((await getPublicationSourceStatuses(a))[0].status).toBe("removed");
    expect(await storage.getUserSources(a)).toEqual([expect.objectContaining({ feedUrl: otherFeed.feedUrl })]);
    expect(await resolutions(a, [source.feedUrl])).toEqual([existingResolution]);
  });

  it("retains a manual deletion made before the profile exists", async () => {
    await ownerDb.delete(userProfiles).where(and(eq(userProfiles.tenantId, a.tenantId), eq(userProfiles.userId, a.userId)));
    const existing = await storage.createUserSource(a, source);
    await storage.deleteUserSource(a, existing.id);
    await storage.createUserProfile(a, { publications: [candidate.name], publicationCandidates: [candidate] });
    await storage.completePublicationResolution(a, candidate.url, await claim(), source);
    expect(await storage.getUserSources(a)).toEqual([]);
    expect((await getPublicationSourceStatuses(a))[0].status).toBe("removed");
  });

  it.each(["pause", "delete"])("serializes completion behind a %s holding the profile lock", async action => {
    const existing = await storage.createUserSource(a, source);
    const token = await claim();
    const [before] = await resolutions();
    const connection = await ownerPool.connect();
    let mutation: Promise<unknown> | undefined;
    let completion: Promise<boolean> | undefined;
    try {
      await connection.query("BEGIN");
      await connection.query("select id from user_sources where id = $1 for update", [existing.id]);
      mutation = action === "delete" ? storage.deleteUserSource(a, existing.id) : storage.updateUserSource(a, existing.id, { isActive: false });
      await vi.waitFor(async () => {
        const { rows } = await pool.query(`select pid from pg_stat_activity where datname = current_database()
          and usename = 'tsp_app' and wait_event_type = 'Lock' and query like '%user_sources%'`);
        expect(rows.length).toBeGreaterThan(0);
      });
      completion = storage.completePublicationResolution(a, candidate.url, token, source);
      await vi.waitFor(async () => {
        const { rows } = await pool.query(`select pid from pg_stat_activity where datname = current_database()
          and usename = 'tsp_app' and wait_event_type = 'Lock' and query like '%user_profiles%'`);
        expect(rows.length).toBeGreaterThan(0);
      });
      await connection.query("COMMIT");
      await mutation;
      expect(await completion).toBe(action === "pause");
      expect((await resolutions())[0].lastAttemptAt).toEqual(before.lastAttemptAt);
      if (action === "pause") expect(await storage.getUserSources(a)).toEqual([{ ...existing, isActive: false }]);
      else {
        expect(await storage.getUserSources(a)).toEqual([]);
        expect(await storage.finishPublicationResolution(a, candidate.url, token, { status: "resolved", sourceId: existing.id })).toBe(false);
      }
    } finally { await connection.query("ROLLBACK"); connection.release(); await mutation; await completion; }
  });

  it.each(["delete", "deselect"])("respects %s queued behind completion without recreating or reactivating", async action => {
    const existing = await storage.createUserSource(a, { ...source, addedVia: "publication" });
    const token = await claim();
    const connection = await ownerPool.connect();
    let completion: Promise<boolean> | undefined;
    let mutation: Promise<unknown> | undefined;
    try {
      await connection.query("BEGIN");
      await connection.query("select url from publication_resolutions where tenant_id = $1 and user_id = $2 and url = $3 for update",
        [a.tenantId, a.userId, candidate.url]);
      completion = storage.completePublicationResolution(a, candidate.url, token, source);
      await vi.waitFor(async () => {
        const { rows } = await pool.query(`select pid from pg_stat_activity where datname = current_database()
          and usename = 'tsp_app' and wait_event_type = 'Lock' and query like '%publication_resolutions%'`);
        expect(rows.length).toBeGreaterThan(0);
      });
      mutation = action === "delete" ? storage.deleteUserSource(a, existing.id) : storage.updateUserProfile(a, { publications: [] });
      await vi.waitFor(async () => {
        const { rows } = await pool.query(`select pid from pg_stat_activity where datname = current_database()
          and usename = 'tsp_app' and wait_event_type = 'Lock' and query like '%user_profiles%'`);
        expect(rows.length).toBeGreaterThan(0);
      });
      await connection.query("COMMIT");
      expect(await completion).toBe(true);
      await mutation;
      await storage.updateUserProfile(a, { publications: [candidate.name], publicationCandidates: [candidate] });
      expect(await storage.claimPublicationResolution(a, candidate.url)).toBeUndefined();
      expect(await storage.completePublicationResolution(a, candidate.url, token, source)).toBe(false);
      expect((await resolutions())[0]).toMatchObject({ status: "resolved", sourceId: existing.id, resolvedFeedUrl: source.feedUrl });
      expect((await getPublicationSourceStatuses(a))[0].status).toBe(action === "delete" ? "removed" : "paused");
      expect(await storage.getUserSources(a)).toEqual(action === "delete" ? [] : [{ ...existing, isActive: false }]);
    } finally { await connection.query("ROLLBACK"); connection.release(); await completion; await mutation; }
  });

  it("enforces RLS with predicate-free reads and rejects cross-tenant writes", async () => {
    await claim(); await claim(c);
    expect(await db.select().from(publicationResolutions)).toHaveLength(0);
    await db.transaction(async tx => {
      await tx.execute(sql`select set_config('app.tenant_id', ${a.tenantId}, true)`);
      const rows = await tx.select().from(publicationResolutions);
      expect(rows).toHaveLength(1);
      expect(rows[0].tenantId).toBe(a.tenantId);
      await tx.delete(publicationResolutions);
    });
    expect(await resolutions(c)).toHaveLength(1);
    await expect(db.transaction(async tx => {
      await tx.execute(sql`select set_config('app.tenant_id', ${a.tenantId}, true)`);
      await tx.insert(publicationResolutions).values({ ...c, url: second.url, status: "failed", lastAttemptAt: new Date() });
    })).rejects.toThrow(/row-level security/i);
  });

  it("serializes concurrent claims and does not refresh an active attempt timestamp", async () => {
    const tokens = await Promise.all(Array.from({ length: 8 }, () => storage.claimPublicationResolution(a, candidate.url)));
    expect(tokens.filter(Boolean)).toHaveLength(1);
    const [first] = await resolutions();
    expect(first.lastAttemptAt).toBeInstanceOf(Date);
    expect(first.leaseUntil!.getTime() - first.lastAttemptAt.getTime()).toBeGreaterThanOrEqual(29_999);
    expect(await storage.claimPublicationResolution(a, candidate.url)).toBeUndefined();
    expect((await resolutions())[0].lastAttemptAt).toEqual(first.lastAttemptAt);
  });

  it("claims only current persisted selections, including legacy URLs and domains", async () => {
    await storage.updateUserProfile(a, { publications: ["Plain publisher", "https://legacy.test/path#fragment", "domain.test"] });
    expect(await storage.claimPublicationResolution(a, candidate.url)).toBeUndefined();
    expect(await storage.claimPublicationResolution(a, "https://plainpublisher.com/")).toBeUndefined();
    await claim(a, "https://legacy.test/path");
    await claim(a, "https://domain.test/");
    expect(await storage.claimPublicationResolution({ ...a, userId: "missing" }, candidate.url)).toBeUndefined();
  });

  it("retries failed attempts with a fresh timestamp/token and fixed safe error text", async () => {
    const token = await claim();
    const oldTime = new Date("2020-01-01T00:00:00Z");
    await ownerDb.update(publicationResolutions).set({ lastAttemptAt: oldTime }).where(resolutionWhere());
    expect(await storage.finishPublicationResolution(a, candidate.url, token, { status: "failed", error: `<script>secret</script> https://user:password@internal.test ${"x".repeat(1000)}` })).toBe(true);
    const [failed] = await resolutions();
    expect(failed).toMatchObject({ status: "failed", lastAttemptAt: oldTime, claimToken: null, leaseUntil: null, sourceId: null });
    expect(failed.error).toBe("Could not connect this publication. Check its URL and try again.");
    const replacement = await claim();
    expect(replacement).not.toBe(token);
    expect((await resolutions())[0].lastAttemptAt.getTime()).toBeGreaterThan(oldTime.getTime());
    expect(await storage.finishPublicationResolution(a, candidate.url, token, { status: "resolved" })).toBe(false);
  });

  it("rejects expired/stale/wrong tokens without source creation, and reclaims expired leases", async () => {
    const stale = await claim();
    expect(await storage.completePublicationResolution(a, candidate.url, "forged", source)).toBe(false);
    await expire();
    expect(await storage.finishPublicationResolution(a, candidate.url, stale, { status: "failed" })).toBe(false);
    expect(await storage.completePublicationResolution(a, candidate.url, stale, source)).toBe(false);
    const fresh = await claim();
    expect(await storage.completePublicationResolution(a, candidate.url, stale, source)).toBe(false);
    expect(await storage.completePublicationResolution(a, candidate.url, fresh, source)).toBe(true);
    expect(await storage.completePublicationResolution(a, candidate.url, fresh, source)).toBe(false);
    expect(await storage.getUserSources(a)).toHaveLength(1);
  });

  it("fences a deselected attempt even if the candidate is subsequently reselected", async () => {
    const token = await claim();
    await storage.updateUserProfile(a, { publications: [] });
    expect(await storage.completePublicationResolution(a, candidate.url, token, source)).toBe(false);
    expect(await storage.finishPublicationResolution(a, candidate.url, token, { status: "failed" })).toBe(false);
    await storage.updateUserProfile(a, { publications: [candidate.name], publicationCandidates: [candidate] });
    expect(await storage.completePublicationResolution(a, candidate.url, token, source)).toBe(false);
    expect(await storage.getUserSources(a)).toEqual([]);
    expect(await claim()).not.toBe(token);
  });

  it("does not commit a source when the lease expires while completion waits on a row lock", async () => {
    const token = await claim();
    await ownerDb.update(publicationResolutions).set({ leaseUntil: sql`clock_timestamp() + interval '500 milliseconds'` }).where(resolutionWhere());
    const connection = await ownerPool.connect();
    let completion: Promise<boolean> | undefined;
    try {
      await connection.query("BEGIN");
      await connection.query("select url from publication_resolutions where tenant_id = $1 and user_id = $2 and url = $3 for update", [a.tenantId, a.userId, candidate.url]);
      completion = storage.completePublicationResolution(a, candidate.url, token, source);
      await vi.waitFor(async () => {
        const { rows } = await pool.query(`select pid from pg_stat_activity where datname = current_database()
          and usename = 'tsp_app' and wait_event_type = 'Lock' and query like '%publication_resolutions%'`);
        expect(rows.length).toBeGreaterThan(0);
      });
      await vi.waitFor(async () => {
        const { rows: [row] } = await connection.query("select lease_until <= clock_timestamp() as expired from publication_resolutions where tenant_id = $1 and user_id = $2 and url = $3", [a.tenantId, a.userId, candidate.url]);
        expect(row.expired).toBe(true);
      }, { timeout: 2000 });
      await connection.query("COMMIT");
      expect(await completion).toBe(false);
      expect(await storage.getUserSources(a)).toEqual([]);
      expect((await resolutions())[0]).toMatchObject({ status: "checking", claimToken: token });
    } finally { await connection.query("ROLLBACK"); connection.release(); await completion; }
  });

  it("serializes completion behind a concurrent profile deselection transaction", async () => {
    const token = await claim();
    const connection = await ownerPool.connect();
    let completion: Promise<boolean> | undefined;
    try {
      await connection.query("BEGIN");
      await connection.query("update user_profiles set publications = '[]', publication_candidates = '[]' where tenant_id = $1 and user_id = $2", [a.tenantId, a.userId]);
      completion = storage.completePublicationResolution(a, candidate.url, token, source);
      await vi.waitFor(async () => {
        const { rows } = await pool.query(`select pid from pg_stat_activity where datname = current_database()
          and usename = 'tsp_app' and wait_event_type = 'Lock' and query like '%user_profiles%'`);
        expect(rows.length).toBeGreaterThan(0);
      });
      await connection.query("COMMIT");
      expect(await completion).toBe(false);
      expect(await storage.getUserSources(a)).toEqual([]);
    } finally { await connection.query("ROLLBACK"); connection.release(); await completion; }
  });

  it("links duplicate feeds without reactivating, relabeling or changing an existing paused source", async () => {
    const existing = await storage.createUserSource(a, { ...source, name: "My paused source", isActive: false, addedVia: "manual" });
    const token = await claim();
    expect(await storage.completePublicationResolution(a, candidate.url, token, { ...source, name: "Replacement", sourceType: "webpage" })).toBe(true);
    expect(await storage.getUserSources(a)).toEqual([existing]);
    expect((await resolutions())[0]).toMatchObject({ status: "resolved", sourceId: existing.id, claimToken: null, leaseUntil: null, error: null });
    const otherToken = await claim(a, second.url);
    expect(await storage.completePublicationResolution(a, second.url, otherToken, source)).toBe(true);
    expect(await storage.getUserSources(a)).toEqual([existing]);
  });

  it("keeps a resolved tombstone after source deletion and does not automatically recreate it", async () => {
    const token = await claim();
    expect(await storage.completePublicationResolution(a, candidate.url, token, { ...source, sourceType: "webpage" })).toBe(true);
    const [resolved] = await resolutions();
    const [created] = await storage.getUserSources(a);
    expect(created).toMatchObject({ addedVia: "publication", sourceType: "webpage", isActive: true });
    await storage.deleteUserSource(a, created.id);
    await storage.updateUserProfile(a, { publications: [] });
    await storage.updateUserProfile(a, { publications: [candidate.name], publicationCandidates: [candidate] });
    expect(await storage.claimPublicationResolution(a, candidate.url)).toBeUndefined();
    expect(await resolutions()).toEqual([resolved]);
    expect(await storage.getUserSources(a)).toEqual([]);
  });

  it("atomically deduplicates concurrent completions for different candidates sharing one feed", async () => {
    const tokens = await Promise.all([claim(), claim(a, second.url)]);
    expect(await Promise.all([
      storage.completePublicationResolution(a, candidate.url, tokens[0], source),
      storage.completePublicationResolution(a, second.url, tokens[1], source),
    ])).toEqual([true, true]);
    const sources = await storage.getUserSources(a);
    expect(sources).toHaveLength(1);
    expect((await resolutions(a, [candidate.url, second.url])).map(row => row.sourceId)).toEqual([sources[0].id, sources[0].id]);
  });

  it("does not link another user's source through finish", async () => {
    const foreign = await storage.createUserSource(b, source);
    const token = await claim();
    expect(await storage.finishPublicationResolution(a, candidate.url, token, { status: "resolved", sourceId: foreign.id })).toBe(false);
    const owned = await storage.createUserSource(a, source);
    expect(await storage.finishPublicationResolution(a, candidate.url, token, { status: "resolved", sourceId: owned.id })).toBe(true);
    expect((await resolutions())[0].resolvedFeedUrl).toBe(source.feedUrl);
  });

  it("propagates arbitrary database errors and rolls back without finishing the claim", async () => {
    const token = await claim();
    await expect(storage.completePublicationResolution(a, candidate.url, token, { ...source, name: null as unknown as string })).rejects.toThrow();
    expect(await storage.getUserSources(a)).toEqual([]);
    expect((await resolutions())[0]).toMatchObject({ status: "checking", claimToken: token });
  });

  it("bounds resolution reads to twenty URLs and handles an empty list", async () => {
    const urls = Array.from({ length: 21 }, (_, i) => `https://bounded${i}.test/`);
    await ownerDb.insert(publicationResolutions).values(urls.map(url => ({ ...a, url, status: "failed" as const, lastAttemptAt: new Date() })));
    expect(await resolutions(a, [])).toEqual([]);
    expect(await resolutions(a, urls)).toHaveLength(20);
    expect((await resolutions(a, urls)).some(row => row.url === urls[20])).toBe(false);
  });

  it("retains metadata for legacy PATCH-selected names, drops removed names, and preserves omitted fields", async () => {
    const response = await request(app).patch("/api/profile").send({ publications: [" research "] });
    expect(response.status).toBe(200);
    expect(response.body.publicationCandidates).toEqual([candidate]);
    const unchanged = await request(app).patch("/api/profile").send({ defaultTone: "professional" });
    expect(unchanged.body.publicationCandidates).toEqual([candidate]);
    expect((await storage.getUserProfile(a))?.publications).toEqual(["research"]);
    expect((await request(app).patch("/api/profile").send({ publications: [] })).body.publicationCandidates).toEqual([]);
    expect((await storage.getUserProfile(b))?.publicationCandidates).toEqual([candidate, second]);
  });

  it("rejects unlinked metadata at the locked storage boundary, not only in HTTP preflight", async () => {
    await storage.updateUserProfile(a, { publications: [] });
    await expect(storage.updateUserProfile(a, { publicationCandidates: [candidate] })).rejects.toThrow(/selected publication names/);
    expect((await storage.getUserProfile(a))?.publicationCandidates).toEqual([]);
  });

  it("returns 400 if metadata-only PATCH loses a race to deselection after HTTP preflight", async () => {
    const getProfile = storage.getUserProfile.bind(storage);
    vi.spyOn(storage, "getUserProfile").mockImplementationOnce(async scope => {
      const stale = await getProfile(scope);
      await storage.updateUserProfile(scope, { publications: [] });
      return stale;
    });
    const response = await request(app).patch("/api/profile").send({ publicationCandidates: [candidate] });
    expect(response.status).toBe(400);
    expect((await getProfile(a))?.publicationCandidates).toEqual([]);
  });

  it("cascades only the deleted profile's resolution records", async () => {
    await claim(); await claim(b); await claim(c);
    await ownerDb.delete(userProfiles).where(and(eq(userProfiles.tenantId, a.tenantId), eq(userProfiles.userId, a.userId)));
    expect(await resolutions()).toEqual([]);
    expect(await resolutions(b)).toHaveLength(1);
    expect(await resolutions(c)).toHaveLength(1);
  });
});