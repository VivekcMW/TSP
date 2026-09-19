import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableColumns } from "drizzle-orm";
import type { Pool } from "pg";
import { socialAccounts, type SocialAccount } from "@shared/schema";
import { decryptWebhookUrl, encryptWebhookUrl } from "./services/webhookSecrets";

const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("./db", () => ({ db: { transaction } }));
import { storage } from "./storage";

// Real Drizzle SQL compilation, fake query/transaction boundary; no pg client.
const query = vi.fn();
const database = drizzle({ query } as unknown as Pool);
const scope = { tenantId: "credential-tenant", userId: "credential-user" };
const columns = Object.keys(getTableColumns(socialAccounts));
let rows: Partial<SocialAccount>[];
let committed: boolean;
let rolledBack: boolean;
function compiledCalls(prefix: string) {
  return query.mock.calls.filter(([config]) => config.text.startsWith(prefix));
}
function encryptedParams(prefix: string): string[] {
  return compiledCalls(prefix).flatMap(([, params]) => params.filter((value: unknown) => typeof value === "string" && value.startsWith("enc:v1:")));
}
beforeEach(() => {
  vi.stubEnv("WEBHOOK_ENCRYPTION_SECRET", "fake-storage-credential-key-at-least-32-characters");
  vi.stubEnv("WEBHOOK_ENCRYPTION_PREVIOUS_SECRETS", "[]");
  rows = []; committed = false; rolledBack = false;
  query.mockReset().mockImplementation(async config => ({ rows: config.text.startsWith('select "') ? rows.map(row => columns.map(column => row[column as keyof SocialAccount] ?? null)) : [] }));
  transaction.mockReset().mockImplementation(async callback => {
    try { const result = await callback(database); committed = true; return result; }
    catch (error) { rolledBack = true; throw error; }
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("social credential repository writes", () => {
  it.each([{ accessToken: "fake-new" }, { refreshToken: null }, { providerAccountId: "identity-B" },
    { provider: "twitter" }, { accountHandle: "new-target" }, { isActive: false }, { accountName: "metadata" }])("increments the version for every update %j", async data => {
    await storage.updateSocialAccount(scope, "id", { ...data, credentialVersion: 0 } as any);
    expect(compiledCalls("update")[0][0].text).toContain('"credential_version" = "social_accounts"."credential_version" + 1');
  });
  it("compiles an atomic tenant/user/id/version CAS and keeps encryption idempotent", async () => {
    const token = encryptWebhookUrl("fake-CAS");
    expect(await storage.compareAndSwapSocialCredentials(scope, "id", 17, { accessToken: token, tokenExpiresAt: null })).toBeUndefined();
    const [config, params] = compiledCalls("update")[0];
    expect(config.text).toContain('"credential_version" = "social_accounts"."credential_version" + 1');
    expect(config.text).toMatch(/where .*"id" = .*"tenant_id" = .*"user_id" = .*"credential_version" =/);
    expect(params.slice(-4)).toEqual(["id", scope.tenantId, scope.userId, 17]);
    expect(encryptedParams("update")).toEqual([token]);
    expect(config.text).not.toContain('"refresh_token" =');
  });
  it.each([undefined, null, -1, 1.5, NaN])("rejects invalid CAS version %s without SQL", async version => {
    await expect(storage.compareAndSwapSocialCredentials(scope, "id", version as number, { accessToken: "fake", tokenExpiresAt: null })).rejects.toThrow("version unavailable");
    expect(query).not.toHaveBeenCalled();
  });
  it("encrypts both fields before insert and enforces trusted tenant/user", async () => {
    const input = { provider: "linkedin", providerAccountId: "real-identity", accessToken: "fake-access", refreshToken: "fake-refresh", tenantId: "spoofed", userId: "spoofed" };
    await storage.createSocialAccount(scope, input);
    const [, params] = compiledCalls("insert")[0];
    expect(encryptedParams("insert").map(decryptWebhookUrl)).toEqual(["fake-access", "fake-refresh"]);
    expect(params).toContain(scope.tenantId); expect(params).toContain(scope.userId);
    expect(params).not.toContain("spoofed"); expect(params).not.toContain("fake-access");
    expect(input.accessToken).toBe("fake-access");
    expect(query.mock.calls[0][1]).toEqual([scope.tenantId]);
  });
  it("authenticates pre-encrypted OAuth values without double encryption", async () => {
    const token = encryptWebhookUrl("fake-oauth-token");
    await storage.createSocialAccount(scope, { provider: "twitter", providerAccountId: "identity", accessToken: token, refreshToken: token });
    expect(encryptedParams("insert")).toEqual([token, token]);
  });
  it("retains an omitted refresh token and scopes updates by id, tenant and user", async () => {
    await storage.updateSocialAccount(scope, "account-id", { accessToken: "fake-new-access" });
    const [config, params] = compiledCalls("update")[0];
    expect(config.text).not.toContain('"refresh_token" =');
    expect(config.text).toMatch(/where \("social_accounts"\."id" = \$\d+ and "social_accounts"\."tenant_id" = \$\d+ and "social_accounts"\."user_id" = \$\d+\)/);
    expect(params.slice(-3)).toEqual(["account-id", scope.tenantId, scope.userId]);
    expect(encryptedParams("update").map(decryptWebhookUrl)).toEqual(["fake-new-access"]);
  });
  it("keeps existing encrypted refresh bytes and explicit null semantics", async () => {
    const retained = encryptWebhookUrl("fake-retained");
    await storage.updateSocialAccount(scope, "id", { refreshToken: retained, accessToken: null });
    const [config, params] = compiledCalls("update")[0];
    expect(encryptedParams("update")).toEqual([retained]);
    expect(config.text).toContain('"access_token" =');
    expect(params).toContain(null);
  });
  it.each(["enc:v1:broken", "", " "]) ("rejects invalid write %s before opening a transaction", async accessToken => {
    await expect(storage.createSocialAccount(scope, { provider: "devto", providerAccountId: "id", accessToken })).rejects.toThrow();
    await expect(storage.updateSocialAccount(scope, "id", { accessToken })).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
  it("fails closed without an encryption key", async () => {
    vi.stubEnv("WEBHOOK_ENCRYPTION_SECRET", "");
    await expect(storage.updateSocialAccount(scope, "id", { accessToken: "fake" })).rejects.toThrow("Credential encryption is not configured");
    expect(query).not.toHaveBeenCalled();
  });
  it("never exposes driver errors containing credential parameters", async () => {
    query.mockRejectedValue(new Error("driver error containing fake-sensitive-parameters"));
    await expect(storage.createSocialAccount(scope, { provider: "devto", providerAccountId: "id", accessToken: "fake-token" })).rejects.toThrow("Could not store social account credentials");
    await expect(storage.updateSocialAccount(scope, "id", { accessToken: "fake-token" })).rejects.toThrow("Could not update social account credentials");
  });
});

describe("explicit credential maintenance", () => {
  it("defaults to dry-run, authenticates envelopes and never writes rows", async () => {
    rows = [{ id: "a", accessToken: "legacy-fake", refreshToken: null }, { id: "b", accessToken: encryptWebhookUrl("fake"), refreshToken: null }];
    const result = await storage.migrateSocialAccountCredentials(scope);
    expect(result).toEqual({ dryRun: true, scanned: 2, candidates: 1, updated: 0, nextAfterId: "b", done: true });
    expect(compiledCalls("update")).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/fake|enc:|Token/);
  });
  it("locks a bounded ordered scoped batch, encrypting only credential fields on explicit apply", async () => {
    rows = [{ id: "b", accessToken: "legacy-access", refreshToken: "legacy-refresh" }];
    expect(await storage.migrateSocialAccountCredentials(scope, { dryRun: false, afterId: "a", limit: 1 })).toEqual({ dryRun: false, scanned: 1, candidates: 1, updated: 1, nextAfterId: "b", done: false });
    const [select, params] = compiledCalls('select "')[0];
    expect(select.text).toContain('"social_accounts"."id" >');
    expect(select.text).toMatch(/order by "social_accounts"\."id" limit \$\d+ for update$/);
    expect(params).toEqual([scope.tenantId, scope.userId, "a", 1]);
    const [update, values] = compiledCalls("update")[0];
    expect(values.slice(-3)).toEqual(["b", scope.tenantId, scope.userId]);
    expect(update.text).not.toMatch(/updated_at|is_active|token_expires_at/);
    expect(update.text).toContain('"credential_version" = "social_accounts"."credential_version" + 1');
    expect(encryptedParams("update").map(decryptWebhookUrl)).toEqual(["legacy-access", "legacy-refresh"]);
    expect(committed).toBe(true);
  });
  it("is idempotent and returns an exhausted resume cursor", async () => {
    rows = [{ id: "b", accessToken: encryptWebhookUrl("already-encrypted"), refreshToken: null }];
    expect((await storage.migrateSocialAccountCredentials(scope, { dryRun: false })).updated).toBe(0);
    rows = [];
    expect(await storage.migrateSocialAccountCredentials(scope, { afterId: "b" })).toMatchObject({ scanned: 0, nextAfterId: "b", done: true });
    expect(compiledCalls("update")).toEqual([]);
  });
  it("aborts the entire batch on a later corrupt row and returns only a safe error", async () => {
    rows = [{ id: "a", accessToken: "legacy-fake", refreshToken: null }, { id: "b", accessToken: "enc:corrupt-secret", refreshToken: null }];
    await expect(storage.migrateSocialAccountCredentials(scope, { dryRun: false })).rejects.toThrow("Credential migration batch failed; no batch changes committed");
    expect(rolledBack).toBe(true); expect(committed).toBe(false);
  });
  it("rotates old-key envelopes only when explicitly requested", async () => {
    const oldKey = "fake-old-storage-credential-key-1234567890";
    vi.stubEnv("WEBHOOK_ENCRYPTION_SECRET", oldKey);
    const old = encryptWebhookUrl("fake-old");
    rows = [{ id: "a", accessToken: old, refreshToken: null }];
    vi.stubEnv("WEBHOOK_ENCRYPTION_SECRET", "fake-new-storage-credential-key-1234567890");
    vi.stubEnv("WEBHOOK_ENCRYPTION_PREVIOUS_SECRETS", JSON.stringify([oldKey]));
    expect((await storage.migrateSocialAccountCredentials(scope, { dryRun: false, rotate: true })).updated).toBe(1);
    const [rotated] = encryptedParams("update");
    vi.stubEnv("WEBHOOK_ENCRYPTION_PREVIOUS_SECRETS", "[]");
    expect(decryptWebhookUrl(rotated)).toBe("fake-old");
    expect(() => decryptWebhookUrl(old)).toThrow();
  });
  it.each([0, 501, -1, 1.5, NaN])("rejects invalid batch limit %s before DB access", async limit => {
    await expect(storage.migrateSocialAccountCredentials(scope, { limit })).rejects.toThrow("Invalid credential migration batch size");
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("durable social OAuth nonce SQL", () => {
  const data = { stateDigest: "a".repeat(64), provider: "twitter", sessionBinding: "b".repeat(64) };
  it("stores only a digest, binding and expiry under trusted scope", async () => {
    await storage.createSocialOAuthState(scope, { ...data, expiresAt: new Date("2030-01-01") });
    const [config, params] = compiledCalls("insert")[0];
    expect(config.text).toContain('"social_oauth_states"');
    expect(params).toEqual(expect.arrayContaining([scope.tenantId, scope.userId, data.stateDigest, data.sessionBinding]));
    expect(config.text).not.toMatch(/code_verifier|access_token|refresh_token|session_id/);
    expect(compiledCalls("delete")[0][0].text).toContain('"expires_at" <= clock_timestamp()');
  });
  it("consumes atomically with tenant/user/provider/digest/session/expiry predicates", async () => {
    expect(await storage.consumeSocialOAuthState(scope, data)).toBe(false);
    const [config, params] = compiledCalls("delete")[0];
    expect(config.text).toMatch(/delete from "social_oauth_states" where .*"tenant_id" = .*"user_id" = .*"state_digest" = .*"provider" = .*"session_binding" = .*"expires_at" > clock_timestamp\(\).*returning/);
    expect(params).toEqual([scope.tenantId, scope.userId, data.stateDigest, data.provider, data.sessionBinding]);
    query.mockImplementation(async config => ({ rows: config.text.startsWith("delete") ? [[data.stateDigest]] : [] }));
    expect(await storage.consumeSocialOAuthState(scope, data)).toBe(true);
  });
  it("fails closed with fixed errors on unavailable persistence", async () => {
    query.mockRejectedValue(new Error("fake-sensitive-driver-error"));
    await expect(storage.createSocialOAuthState(scope, { ...data, expiresAt: new Date() })).rejects.toThrow("Could not start connection");
    await expect(storage.consumeSocialOAuthState(scope, data)).rejects.toThrow("Could not verify connection");
  });
});