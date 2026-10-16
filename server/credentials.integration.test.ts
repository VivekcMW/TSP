import { randomBytes, randomUUID } from "node:crypto";
import { requireLocalTestDatabase } from "../test/database-safety";
import type { Express, Request, RequestHandler, Response } from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { insertSocialAccountSchema, socialAccounts, socialOAuthStates, tenantMembers, tenants, users } from "@shared/schema";
import type { TenantScope } from "./storage";

// Parent-only opt-in. No DB import when skipped, no dotenv, owner connection,
// migration, global cleanup, real authentication, or live provider exchange.
// Run this file ALONE after other DB suites finish (some delete global fixtures).
// Session/callback authorization remains in socialOAuth.callbacks.mock.test.ts.
vi.mock("./middlewares/requireDbUser", () => ({
  requireDbUser: vi.fn(), authedOf: (req: Request) => ({ tenant: req.tenant }),
}));
vi.mock("./middlewares/requirePermission", () => ({ requirePermission: () => vi.fn() }));
vi.mock("./services/publishers/devto", () => ({ verifyDevToApiKey: vi.fn(() => { throw new Error("Provider forbidden"); }) }));
vi.mock("./services/publishers/hashnode", () => ({ resolveHashnodePublication: vi.fn(() => { throw new Error("Provider forbidden"); }) }));
vi.mock("./services/publishers/mastodon", () => ({ verifyMastodonAccessToken: vi.fn(() => { throw new Error("Provider forbidden"); }) }));
vi.mock("./services/publishers/bluesky", () => ({ verifyBlueskyAppPassword: vi.fn(() => { throw new Error("Provider forbidden"); }) }));
vi.mock("./services/publishers/telegram", () => ({ verifyTelegramBot: vi.fn(() => { throw new Error("Provider forbidden"); }) }));
vi.mock("./services/webhookPublisher", () => ({ WEBHOOK_PROVIDERS: [], isValidWebhookUrl: () => false,
  verifyWebhook: vi.fn(() => { throw new Error("Provider forbidden"); }) }));

type Tx = Parameters<Parameters<typeof import("./db").db.transaction>[0]>[0];
type AccountPatch = Parameters<typeof import("./storage").storage.updateSocialAccount>[2];
const key = "credential-db-test-only-encryption-key-32-characters";
const secret = (label: string) => `credential-db-secret-${label}`;
const nonce = () => ({ provider: "linkedin", stateDigest: randomBytes(32).toString("hex"),
  sessionBinding: randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + 600_000) });

describe.skipIf(process.env.CREDENTIALS_DB_TESTS !== "true")("roadmap 21/27 credential PostgreSQL acceptance", () => {
  let app: typeof import("./db");
  let repository: typeof import("./storage");
  let crypto: typeof import("./services/webhookSecrets");
  let a: TenantScope, sameUserOtherTenant: TenantScope, sameTenantOtherUser: TenantScope;
  let fixtureTenants: string[] = [], fixtureUsers: string[] = [];
  const handlers = new Map<string, RequestHandler>();

  async function inTenant<T>(tenantId: string | undefined, work: (tx: Tx) => Promise<T>): Promise<T> {
    return app.db.transaction(async tx => {
      if (tenantId === undefined) {
        await tx.execute(sql`reset app.tenant_id`);
        const unset = await tx.execute(sql`select nullif(current_setting('app.tenant_id', true), '') as tenant`);
        expect(unset.rows[0].tenant).toBeNull();
      } else await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      return work(tx);
    });
  }
  const readAccounts = (scope = a) => inTenant(scope.tenantId, tx => tx.select().from(socialAccounts)
    .where(and(eq(socialAccounts.tenantId, scope.tenantId), eq(socialAccounts.userId, scope.userId))).orderBy(socialAccounts.id));
  const readNonces = (scope = a) => inTenant(scope.tenantId, tx => tx.select().from(socialOAuthStates)
    .where(and(eq(socialOAuthStates.tenantId, scope.tenantId), eq(socialOAuthStates.userId, scope.userId))));
  const createAccount = (patch: AccountPatch = {}, scope = a) => repository.storage.createSocialAccount(scope, {
    provider: "linkedin", providerAccountId: randomUUID(), accessToken: secret("original-access"),
    refreshToken: secret("original-refresh"), scopes: ["w_member_social"], ...patch,
  });
  function noLeak(value: unknown) {
    expect(JSON.stringify(value)).not.toMatch(/credential-db-secret-|enc:v1:|accessToken|refreshToken|access_token|refresh_token/);
  }
  async function pgReject(work: Promise<unknown>, code: string) {
    // Drizzle wraps the driver error as cause. Require the actual SQLSTATE,
    // not merely any rejection (which could hide a broken test fixture).
    const error: unknown = await work.then(() => undefined, reason => reason);
    expect(error).toBeDefined();
    let current = error;
    for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
      if ("code" in current && current.code === code) return;
      current = "cause" in current ? current.cause : undefined;
    }
    throw new Error(`Expected PostgreSQL SQLSTATE ${code}`);
  }

  // Invoke the actual registered final handler with a response recorder. Auth
  // middleware and TCP transport are NOT under test; SQL/refresh/sanitizer are.
  async function invoke(method: "GET" | "POST", route: string, scope = a) {
    let status = 200, body: unknown;
    const headers: Record<string, unknown> = {};
    const response = { status(code: number) { status = code; return this; },
      json(value: unknown) { body = value; return this; },
      setHeader(name: string, value: unknown) { headers[name.toLowerCase()] = value; return this; } };
    const handler = handlers.get(`${method} ${route}`);
    expect(handler).toBeDefined();
    await handler!({ params: { provider: "linkedin" }, tenant: scope, body: {} } as unknown as Request,
      response as unknown as Response, error => { throw error ?? new Error("Unexpected next()"); });
    return { status, body, headers };
  }
  const refresh = () => invoke("POST", "/api/integrations/:provider/refresh");

  beforeAll(async () => {
    const expected = requireLocalTestDatabase();
    vi.stubEnv("DB_POOL_MAX", "4"); vi.stubEnv("DB_CONNECTION_TIMEOUT_MS", "2000");
    vi.stubEnv("DB_STATEMENT_TIMEOUT_MS", "5000"); vi.stubEnv("DB_IDLE_TRANSACTION_TIMEOUT_MS", "10000");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External fetch forbidden"); }));
    app = await import("./db");
    const target = await app.pool.query(`select current_database() as db, inet_server_port() as port,
      current_user as role, rolsuper, rolbypassrls from pg_roles where rolname = current_user`);
    expect(target.rows).toEqual([{ db: expected.database, port: expected.port, role: "tsp_app", rolsuper: false, rolbypassrls: false }]);
    const flags = await app.pool.query(`select c.relname, c.relrowsecurity, c.relforcerowsecurity,
      pg_get_userbyid(c.relowner) = current_user as owns, row_security_active(c.oid) as active
      from pg_class c where c.oid in ('public.social_accounts'::regclass, 'public.social_oauth_states'::regclass) order by c.relname`);
    expect(flags.rows).toEqual(["social_accounts", "social_oauth_states"].map(relname => ({
      relname, relrowsecurity: true, relforcerowsecurity: true, owns: false, active: true,
    })));
    const grants = await app.pool.query(`select has_table_privilege(current_user, 'public.social_accounts', 'SELECT')
      and has_table_privilege(current_user, 'public.social_accounts', 'INSERT')
      and has_table_privilege(current_user, 'public.social_accounts', 'UPDATE')
      and has_table_privilege(current_user, 'public.social_accounts', 'DELETE')
      and has_table_privilege(current_user, 'public.social_oauth_states', 'SELECT')
      and has_table_privilege(current_user, 'public.social_oauth_states', 'INSERT')
      and has_table_privilege(current_user, 'public.social_oauth_states', 'DELETE') as ok`);
    expect(grants.rows[0].ok).toBe(true);
    const policies = await app.pool.query(`select tablename, policyname, cmd, qual, with_check from pg_policies
      where schemaname = 'public' and tablename in ('social_accounts', 'social_oauth_states') order by tablename, policyname`);
    expect(policies.rows).toHaveLength(2);
    for (const policy of policies.rows) {
      expect(policy).toMatchObject({ policyname: "tenant_isolation", cmd: "ALL" });
      expect(policy.qual).toMatch(/tenant_id.*current_setting\('app\.tenant_id'/);
      expect(policy.with_check).toMatch(/tenant_id.*current_setting\('app\.tenant_id'/);
    }
    await app.pool.query("select credential_version from public.social_accounts limit 0");
    repository = await import("./storage"); crypto = await import("./services/webhookSecrets");
    const register = (method: string) => (route: string, ...callbacks: RequestHandler[]) => {
      handlers.set(`${method} ${route}`, callbacks.at(-1)!);
    };
    (await import("./routes/integrations")).registerIntegrationsRoutes({
      get: register("GET"), post: register("POST"), delete: register("DELETE"),
    } as unknown as Express);
  }, 15000);

  beforeEach(async () => {
    vi.stubEnv("WEBHOOK_ENCRYPTION_SECRET", key); vi.stubEnv("WEBHOOK_ENCRYPTION_PREVIOUS_SECRETS", "[]");
    vi.stubEnv("LINKEDIN_CLIENT_ID", "credential-db-fake-client"); vi.stubEnv("LINKEDIN_CLIENT_SECRET", "credential-db-fake-client-secret");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External fetch forbidden"); }));
    fixtureTenants = [randomUUID(), randomUUID()]; fixtureUsers = [randomUUID(), randomUUID()];
    a = { tenantId: fixtureTenants[0], userId: fixtureUsers[0] };
    sameUserOtherTenant = { ...a, tenantId: fixtureTenants[1] };
    sameTenantOtherUser = { ...a, userId: fixtureUsers[1] };
    await app.db.transaction(async tx => {
      await tx.insert(tenants).values(fixtureTenants.map(id => ({ id, name: "Credentials acceptance only", kind: "corporate" })));
      await tx.insert(users).values(fixtureUsers.map(id => ({ id, email: `${id}@credentials.example.invalid`, emailVerified: true })));
      await tx.insert(tenantMembers).values([a, sameUserOtherTenant, sameTenantOtherUser].map(scope => ({ ...scope, role: "owner" })));
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      if (app && fixtureTenants.length) await app.db.transaction(async tx => {
        for (const tenantId of fixtureTenants) {
          await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
          await tx.delete(socialOAuthStates).where(and(eq(socialOAuthStates.tenantId, tenantId), inArray(socialOAuthStates.userId, fixtureUsers)));
          await tx.delete(socialAccounts).where(and(eq(socialAccounts.tenantId, tenantId), inArray(socialAccounts.userId, fixtureUsers)));
          await tx.delete(tenantMembers).where(and(eq(tenantMembers.tenantId, tenantId), inArray(tenantMembers.userId, fixtureUsers)));
        }
        await tx.delete(tenants).where(inArray(tenants.id, fixtureTenants));
        await tx.delete(users).where(inArray(users.id, fixtureUsers));
      });
    } finally { fixtureTenants = []; fixtureUsers = []; vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
  });
  afterAll(async () => { await app?.pool.end(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  // Instrument BEGIN only: both REAL transactions hold different pool clients
  // before either repository body runs. No SQL/result/commit/rollback is mocked.
  async function concurrently<T>(first: () => Promise<T>, second: () => Promise<T>): Promise<T[]> {
    const original = app.db.transaction.bind(app.db);
    const pids = new Set<unknown>(); let arrivals = 0, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const timer = setTimeout(release, 3000);
    const spy = vi.spyOn(app.db, "transaction").mockImplementation((work, config) => original(async tx => {
      pids.add((await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0].pid);
      if (++arrivals === 2) release();
      await gate;
      expect(arrivals).toBe(2);
      return work(tx);
    }, config));
    try {
      const results = await Promise.allSettled([first(), second()]);
      expect(pids.size).toBe(2);
      return results.map(result => {
        if (result.status === "rejected") throw result.reason;
        return result.value;
      });
    } finally { release(); clearTimeout(timer); spy.mockRestore(); }
  }

  it.each(["unset", "foreign"] as const)("enforces %s tenant RLS for raw reads, writes and deletes", async variant => {
    const account = await createAccount(), state = nonce();
    await repository.storage.createSocialOAuthState(a, state);
    const tenantId = variant === "unset" ? undefined : sameUserOtherTenant.tenantId;
    await inTenant(tenantId, async tx => {
      expect(await tx.select().from(socialAccounts).where(eq(socialAccounts.id, account.id))).toEqual([]);
      expect(await tx.select().from(socialOAuthStates).where(eq(socialOAuthStates.stateDigest, state.stateDigest))).toEqual([]);
      expect(await tx.update(socialAccounts).set({ accessToken: secret("forbidden") }).where(eq(socialAccounts.id, account.id)).returning()).toEqual([]);
      expect(await tx.delete(socialAccounts).where(eq(socialAccounts.id, account.id)).returning()).toEqual([]);
      expect(await tx.delete(socialOAuthStates).where(eq(socialOAuthStates.stateDigest, state.stateDigest)).returning()).toEqual([]);
    });
    await pgReject(inTenant(tenantId, tx => tx.insert(socialAccounts).values({ ...account, id: randomUUID() })), "42501");
    await pgReject(inTenant(tenantId, tx => tx.insert(socialOAuthStates).values({ ...nonce(), ...a })), "42501");
    expect(await readAccounts()).toEqual([account]); expect(await readNonces()).toHaveLength(1);
    expect(await repository.storage.consumeSocialOAuthState(a, state)).toBe(true);
  });

  it("leaves nonces and credentials intact after wrong tenant/user/provider/session/digest attempts", async () => {
    const state = nonce(), account = await createAccount();
    await repository.storage.createSocialOAuthState(a, state);
    for (const scope of [sameUserOtherTenant, sameTenantOtherUser]) {
      expect(await repository.storage.consumeSocialOAuthState(scope, state)).toBe(false);
      expect(await repository.storage.getSocialAccounts(scope)).toEqual([]);
      expect(await repository.storage.getSocialAccountByProvider(scope, "linkedin")).toBeUndefined();
      expect(await repository.storage.updateSocialAccount(scope, account.id, { accessToken: secret("wrong-scope") })).toBeUndefined();
      expect(await repository.storage.compareAndSwapSocialCredentials(scope, account.id, 0, { accessToken: secret("wrong-CAS"), tokenExpiresAt: null })).toBeUndefined();
      await repository.storage.deleteSocialAccount(scope, account.id);
    }
    for (const change of [{ provider: "twitter" }, { sessionBinding: nonce().sessionBinding }, { stateDigest: nonce().stateDigest }]) {
      expect(await repository.storage.consumeSocialOAuthState(a, { ...state, ...change })).toBe(false);
      expect(await readNonces()).toHaveLength(1);
    }
    expect(await readAccounts()).toEqual([account]);
    expect(await repository.storage.consumeSocialOAuthState(a, state)).toBe(true);
    expect(await repository.storage.consumeSocialOAuthState(a, state)).toBe(false);
  });

  it("has exactly one nonce winner on two PostgreSQL connections; new repository cannot replay", async () => {
    const state = nonce(); await repository.storage.createSocialOAuthState(a, state);
    const peer = new repository.DatabaseStorage();
    expect((await concurrently(() => repository.storage.consumeSocialOAuthState(a, state),
      () => peer.consumeSocialOAuthState(a, state))).sort()).toEqual([false, true]);
    expect(await readNonces()).toEqual([]);
    expect(await new repository.DatabaseStorage().consumeSocialOAuthState(a, state)).toBe(false);
  }, 15000);

  it("rejects expiry by the DB clock and prunes only the initiating tenant/user", async () => {
    const expired = { ...nonce(), expiresAt: new Date(0) };
    const otherUser = { ...nonce(), expiresAt: new Date(0) }, otherTenant = { ...nonce(), expiresAt: new Date(0) };
    await repository.storage.createSocialOAuthState(a, expired);
    await repository.storage.createSocialOAuthState(sameTenantOtherUser, otherUser);
    await repository.storage.createSocialOAuthState(sameUserOtherTenant, otherTenant);
    expect(await repository.storage.consumeSocialOAuthState(a, expired)).toBe(false);
    expect(await readNonces()).toHaveLength(1);
    const first = nonce(), second = nonce();
    await repository.storage.createSocialOAuthState(a, first); await repository.storage.createSocialOAuthState(a, second);
    expect((await readNonces()).map(row => row.stateDigest).sort()).toEqual([first.stateDigest, second.stateDigest].sort());
    expect(await readNonces(sameTenantOtherUser)).toHaveLength(1); expect(await readNonces(sameUserOtherTenant)).toHaveLength(1);
    expect(await repository.storage.consumeSocialOAuthState(a, first)).toBe(true);
    expect(await repository.storage.consumeSocialOAuthState(a, second)).toBe(true);
  });

  it("rolls nonce cleanup back when a later actual INSERT fails", async () => {
    const live = nonce(); await repository.storage.createSocialOAuthState(a, live);
    const expired = { ...nonce(), expiresAt: new Date(0) }; await repository.storage.createSocialOAuthState(a, expired);
    const before = await readNonces();
    await expect(repository.storage.createSocialOAuthState(a, live)).rejects.toThrow("Could not start connection; retry from Connections");
    expect((await readNonces()).sort((x, y) => x.stateDigest.localeCompare(y.stateDigest)))
      .toEqual(before.sort((x, y) => x.stateDigest.localeCompare(y.stateDigest)));
    expect(await repository.storage.consumeSocialOAuthState(a, live)).toBe(true);
  });

  it("restores a consumed nonce on a real PostgreSQL error before COMMIT", async () => {
    const state = nonce(); await repository.storage.createSocialOAuthState(a, state);
    const original = app.db.transaction.bind(app.db);
    let deleted = false;
    const spy = vi.spyOn(app.db, "transaction").mockImplementation((work, config) => original(async tx => {
      const result = await work(tx);
      deleted = result === true;
      await tx.execute(sql`select 1 / 0`); // Actual driver failure after DELETE RETURNING.
      return result;
    }, config));
    try {
      await expect(repository.storage.consumeSocialOAuthState(a, state)).rejects.toThrow(/^Could not verify connection; restart from Connections$/);
      expect(deleted).toBe(true);
    } finally { spy.mockRestore(); }
    expect(await readNonces()).toHaveLength(1);
    expect(await repository.storage.consumeSocialOAuthState(a, state)).toBe(true);
    expect(await repository.storage.consumeSocialOAuthState(a, state)).toBe(false);
  });

  it("stores authenticated ciphertext, ignores supplied version/scope, preserves omission and clears explicit null", async () => {
    const input = { provider: "linkedin", providerAccountId: randomUUID(), accessToken: secret("access"), refreshToken: secret("refresh"),
      credentialVersion: 900, tenantId: sameUserOtherTenant.tenantId, userId: sameTenantOtherUser.userId };
    expect(insertSocialAccountSchema.parse(input)).not.toHaveProperty("credentialVersion");
    const account = await repository.storage.createSocialAccount(a, input);
    expect(account).toMatchObject({ ...a, credentialVersion: 0 }); expect(input.accessToken).toBe(secret("access"));
    const [stored] = await readAccounts();
    expect(stored.accessToken).toMatch(/^enc:v1:/); expect(stored.refreshToken).toMatch(/^enc:v1:/);
    expect(crypto.decryptWebhookUrl(stored.accessToken!)).toBe(secret("access"));
    expect(crypto.decryptWebhookUrl(stored.refreshToken!)).toBe(secret("refresh"));
    const updated = await repository.storage.updateSocialAccount(a, account.id, { accessToken: stored.accessToken, refreshToken: undefined });
    expect(updated).toMatchObject({ accessToken: stored.accessToken, refreshToken: stored.refreshToken, credentialVersion: 1 });
    await repository.storage.updateSocialAccount(a, account.id, { accessToken: null, refreshToken: null, tokenExpiresAt: null });
    expect((await readAccounts())[0]).toMatchObject({ accessToken: null, refreshToken: null, tokenExpiresAt: null, credentialVersion: 2 });
  });

  const writes: { name: string; patch: AccountPatch }[] = [
    { name: "access", patch: { accessToken: secret("new-access") } },
    { name: "refresh", patch: { refreshToken: secret("new-refresh") } },
    { name: "identical credential", patch: { accessToken: secret("original-access") } },
    { name: "null credentials", patch: { accessToken: null, refreshToken: null } },
    { name: "identity", patch: { providerAccountId: "identity-B" } },
    { name: "provider", patch: { provider: "twitter" } },
    { name: "target", patch: { accountHandle: "target-B" } },
    { name: "active state", patch: { isActive: false } },
    { name: "name", patch: { accountName: "Name B" } },
    { name: "image", patch: { profileImageUrl: "https://example.invalid/avatar" } },
    { name: "scopes", patch: { scopes: ["changed"] } },
    { name: "expiry", patch: { tokenExpiresAt: new Date("2030-01-01T00:00:00Z") } },
    { name: "sync metadata", patch: { lastSyncAt: new Date("2026-01-01T00:00:00Z") } },
    { name: "empty update", patch: {} },
  ];
  it.each(writes)("increments server-owned version on $name write and fences old CAS", async ({ patch }) => {
    const account = await createAccount();
    const malicious = { ...patch, credentialVersion: 0 };
    const updated = await repository.storage.updateSocialAccount(a, account.id, malicious);
    expect(updated?.credentialVersion).toBe(1);
    expect(await repository.storage.compareAndSwapSocialCredentials(a, account.id, 0,
      { accessToken: secret("late"), tokenExpiresAt: null })).toBeUndefined();
    expect(await readAccounts()).toEqual([updated]);
  });

  it("increments concurrent writes atomically and lets only one identical-version CAS commit", async () => {
    const account = await createAccount();
    const writes = await concurrently(() => repository.storage.updateSocialAccount(a, account.id, { accountName: "B" }),
      () => repository.storage.updateSocialAccount(a, account.id, { accountHandle: "C" }));
    expect(writes.map(row => row!.credentialVersion).sort()).toEqual([1, 2]);
    expect((await readAccounts())[0]).toMatchObject({ accountName: "B", accountHandle: "C", credentialVersion: 2 });
    const results = await concurrently(() => repository.storage.compareAndSwapSocialCredentials(a, account.id, 2,
      { accessToken: secret("CAS-A"), tokenExpiresAt: null }),
    () => repository.storage.compareAndSwapSocialCredentials(a, account.id, 2,
      { accessToken: secret("CAS-B"), refreshToken: secret("CAS-rotated"), tokenExpiresAt: null }));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await readAccounts()).toEqual(results.filter(Boolean));
    expect(results.find(Boolean)?.credentialVersion).toBe(3);
  }, 15000);

  it("enforces the database version default/nonnegative check without changing schema", async () => {
    const [legacy] = await inTenant(a.tenantId, tx => tx.insert(socialAccounts).values({ ...a,
      provider: "linkedin", providerAccountId: randomUUID(), accessToken: secret("legacy") }).returning());
    expect(legacy.credentialVersion).toBe(0);
    await pgReject(inTenant(a.tenantId, tx => tx.update(socialAccounts).set({ credentialVersion: -1 }).where(eq(socialAccounts.id, legacy.id))), "23514");
    expect(await readAccounts()).toEqual([legacy]);
  });

  it("backfills/rotates only explicit scoped writes, increments versions, and retains idempotence", async () => {
    const [legacy] = await inTenant(a.tenantId, tx => tx.insert(socialAccounts).values({ ...a,
      provider: "linkedin", providerAccountId: randomUUID(), accessToken: secret("legacy"), refreshToken: secret("legacy-refresh") }).returning());
    const untouched = await createAccount({}, sameTenantOtherUser);
    expect(await repository.storage.migrateSocialAccountCredentials(a)).toMatchObject({ dryRun: true, candidates: 1, updated: 0 });
    expect(await readAccounts()).toEqual([legacy]);
    noLeak(await repository.storage.migrateSocialAccountCredentials(a, { dryRun: false }));
    const [backfilled] = await readAccounts();
    expect(backfilled.credentialVersion).toBe(1); expect(crypto.decryptWebhookUrl(backfilled.accessToken!)).toBe(secret("legacy"));
    expect(crypto.decryptWebhookUrl(backfilled.refreshToken!)).toBe(secret("legacy-refresh"));
    expect(await repository.storage.migrateSocialAccountCredentials(a, { dryRun: false })).toMatchObject({ candidates: 0, updated: 0 });
    expect(await readAccounts()).toEqual([backfilled]);
    vi.stubEnv("WEBHOOK_ENCRYPTION_SECRET", "credential-db-new-test-encryption-key-32-characters");
    vi.stubEnv("WEBHOOK_ENCRYPTION_PREVIOUS_SECRETS", JSON.stringify([key]));
    expect(await repository.storage.migrateSocialAccountCredentials(a, { dryRun: false, rotate: true })).toMatchObject({ updated: 1 });
    vi.stubEnv("WEBHOOK_ENCRYPTION_PREVIOUS_SECRETS", "[]");
    const [rotated] = await readAccounts();
    expect(rotated.credentialVersion).toBe(2); expect(rotated.accessToken).not.toBe(backfilled.accessToken);
    expect(crypto.decryptWebhookUrl(rotated.accessToken!)).toBe(secret("legacy"));
    expect(crypto.decryptWebhookUrl(rotated.refreshToken!)).toBe(secret("legacy-refresh"));
    expect(() => crypto.decryptWebhookUrl(backfilled.accessToken!)).toThrow();
    expect(await readAccounts(sameTenantOtherUser)).toEqual([untouched]);
    expect(await repository.storage.compareAndSwapSocialCredentials(a, legacy.id, 1,
      { accessToken: secret("late-before-rotation"), tokenExpiresAt: null })).toBeUndefined();
  });

  it("rolls the whole maintenance batch back after the first row update and a later corrupt envelope", async () => {
    await inTenant(a.tenantId, tx => tx.insert(socialAccounts).values([
      { ...a, id: `a-${randomUUID()}`, provider: "linkedin", providerAccountId: randomUUID(), accessToken: secret("legacy-first") },
      { ...a, id: `z-${randomUUID()}`, provider: "twitter", providerAccountId: randomUUID(), accessToken: "enc:v1:corrupt" },
    ]));
    const before = await readAccounts();
    await expect(repository.storage.migrateSocialAccountCredentials(a, { dryRun: false })).rejects.toThrow("Credential migration batch failed; no batch changes committed");
    expect(await readAccounts()).toEqual(before);
  });

  it("rejects forged envelopes and rolls real SQL write errors back without leaking parameters", async () => {
    const account = await createAccount();
    await expect(repository.storage.updateSocialAccount(a, account.id, { accessToken: "enc:v1:corrupt" })).rejects.toThrow("Stored credential could not be decrypted");
    const parts = account.accessToken!.slice("enc:v1:".length).split(".");
    const tag = Buffer.from(parts[1], "base64url"); tag[0] ^= 1; parts[1] = tag.toString("base64url");
    await expect(repository.storage.updateSocialAccount(a, account.id,
      { accessToken: `enc:v1:${parts.join(".")}` })).rejects.toThrow("Stored credential could not be decrypted");
    await expect(repository.storage.updateSocialAccount(a, account.id, { accessToken: secret("attempt"),
      providerAccountId: `${secret("driver-parameter")}\u0000` })).rejects.toThrow(/^Could not update social account credentials$/);
    await expect(createAccount({ providerAccountId: `${secret("driver-parameter")}\u0000` })).rejects.toThrow(/^Could not store social account credentials$/);
    expect(await readAccounts()).toEqual([account]);
  });

  it("rolls failed CAS back atomically and reports token-free refresh failure, not success", async () => {
    const account = await createAccount();
    // Only this fixture is moved to the integer boundary; no shared DDL/triggers.
    await inTenant(a.tenantId, tx => tx.update(socialAccounts).set({ credentialVersion: 2_147_483_647 })
      .where(eq(socialAccounts.id, account.id)));
    const before = await readAccounts();
    await expect(repository.storage.compareAndSwapSocialCredentials(a, account.id, 2_147_483_647,
      { accessToken: secret("overflow-access"), refreshToken: secret("overflow-refresh"), tokenExpiresAt: null }))
      .rejects.toThrow(/^Could not update social account credentials$/);
    expect(await readAccounts()).toEqual(before);
    vi.mocked(fetch).mockResolvedValueOnce(new globalThis.Response(JSON.stringify({
      access_token: secret("failed-refresh"), refresh_token: secret("failed-refresh-rotation"),
    })));
    const result = await refresh();
    expect(result).toMatchObject({ status: 200, headers: { "cache-control": "no-store" },
      body: { result: { success: false, status: "failed", reason: "Could not refresh and store provider credentials" } } });
    noLeak(result); expect(await readAccounts()).toEqual(before);
  });

  it("returns token-free status and successful refresh, persisting encrypted tokens and real expiry", async () => {
    const account = await createAccount();
    const status = await invoke("GET", "/api/integrations/:provider/status");
    expect(status.status).toBe(200); expect(status.body).toMatchObject({ connected: true, instance: { id: account.id } }); noLeak(status);
    vi.mocked(fetch).mockResolvedValueOnce(new globalThis.Response(JSON.stringify({ access_token: secret("refreshed"), expires_in: 60 })));
    const start = Date.now(), response = await refresh();
    expect(response).toMatchObject({ status: 200, body: { result: { success: true, status: "ok" } }, headers: { "cache-control": "no-store" } });
    noLeak(response);
    const [stored] = await readAccounts();
    expect(stored.credentialVersion).toBe(1); expect(stored.refreshToken).toBe(account.refreshToken);
    expect(crypto.decryptWebhookUrl(stored.accessToken!)).toBe(secret("refreshed"));
    expect(stored.tokenExpiresAt!.getTime()).toBeGreaterThanOrEqual(start + 60_000);
    expect(stored.tokenExpiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
    vi.mocked(fetch).mockResolvedValueOnce(new globalThis.Response(JSON.stringify({ access_token: secret("second"), refresh_token: secret("rotated") })));
    const second = await refresh();
    expect(second.body).toMatchObject({ result: { success: true, status: "ok" } }); noLeak(second);
    const [rotated] = await readAccounts();
    expect(rotated).toMatchObject({ credentialVersion: 2, tokenExpiresAt: null });
    expect(crypto.decryptWebhookUrl(rotated.refreshToken!)).toBe(secret("rotated"));
  });

  it.each(["reconnect", "refresh", "delete-recreate"] as const)("rejects late refresh A after committed %s B with 409 and no token leak", async winner => {
    const account = await createAccount();
    let announce!: () => void, release!: (value: globalThis.Response) => void;
    const started = new Promise<void>(resolve => { announce = resolve; });
    const held = new Promise<globalThis.Response>(resolve => { release = resolve; });
    const late = () => new globalThis.Response(JSON.stringify({ access_token: secret("late-A"), refresh_token: secret("late-refresh-A") }));
    vi.mocked(fetch).mockImplementationOnce(async () => { announce(); return held; });
    // Bounded rendezvous and unconditional release avoid hanging on a regression.
    const timer = setTimeout(() => { announce(); release(late()); }, 3000);
    const pending = refresh();
    try {
      await started;
      expect(fetch).toHaveBeenCalledTimes(1);
      if (winner === "reconnect") {
        await repository.storage.updateSocialAccount(a, account.id, { providerAccountId: "identity-B", accountHandle: "target-B",
          accessToken: secret("B"), refreshToken: secret("refresh-B") });
      } else if (winner === "refresh") {
        vi.mocked(fetch).mockResolvedValueOnce(new globalThis.Response(JSON.stringify({ access_token: secret("B"), refresh_token: secret("refresh-B") })));
        const result = await refresh(); expect(result.body).toMatchObject({ result: { success: true } }); noLeak(result);
      } else {
        await repository.storage.deleteSocialAccount(a, account.id);
        const replacement = await createAccount({ providerAccountId: account.providerAccountId, accessToken: secret("B") });
        expect(replacement.id).not.toBe(account.id); expect(replacement.credentialVersion).toBe(0);
      }
      const committed = await readAccounts();
      release(late());
      const result = await pending;
      expect(result).toMatchObject({ status: 409, headers: { "cache-control": "no-store" }, body: {
        result: { success: false, status: "failed", reason: expect.stringContaining("reload Connections") },
      } });
      noLeak(result); expect(await readAccounts()).toEqual(committed);
    } finally { clearTimeout(timer); release(late()); await pending; }
  }, 15000);
});