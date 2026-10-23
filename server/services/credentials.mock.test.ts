import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptStoredCredential, decryptWebhookUrl, encryptSocialAccountCredentials, encryptWebhookUrl, rotateStoredCredential, socialCredentialMigrationPatch } from "./webhookSecrets";

const active = "fake-current-key-for-credential-tests-only-12345";
const previous = "fake-previous-key-for-credential-tests-only-123";
beforeEach(() => {
  vi.stubEnv("WEBHOOK_ENCRYPTION_SECRET", active);
  vi.stubEnv("WEBHOOK_ENCRYPTION_PREVIOUS_SECRETS", "[]");
});
afterEach(() => vi.unstubAllEnvs());

describe("credential envelopes (fake keys only)", () => {
  it("uses randomized AES-GCM and authenticates an idempotent OAuth write", () => {
    const first = encryptWebhookUrl("fake-access");
    expect(first).toMatch(/^enc:v1:/);
    expect(encryptWebhookUrl("fake-access")).not.toBe(first);
    expect(encryptWebhookUrl(first)).toBe(first);
    expect(decryptWebhookUrl(first)).toBe("fake-access");
  });
  it("reads the existing v1 format independently of the new writer", () => {
    const iv = Buffer.alloc(12, 7);
    const cipher = crypto.createCipheriv("aes-256-gcm", crypto.createHash("sha256").update(active).digest(), iv);
    const body = Buffer.concat([cipher.update("old-format-token"), cipher.final()]);
    expect(decryptWebhookUrl(`enc:v1:${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`)).toBe("old-format-token");
  });
  it.each(["enc:v2:a.b.c", "enc:v1:a.b.c", "enc:v1:a.b.c.extra", "enc:v1:!!.a.b", "enc:fake"]) ("rejects malformed/reserved envelope %s without plaintext fallback", value => {
    expect(() => decryptStoredCredential(value)).toThrow("Stored credential could not be decrypted");
    expect(() => encryptWebhookUrl(value)).toThrow("Stored credential could not be decrypted");
  });
  it("rejects a tampered authentication tag and the wrong key", () => {
    const envelope = encryptWebhookUrl("fake-secret");
    const parts = envelope.slice(7).split(".");
    parts[1] = Buffer.alloc(16).toString("base64url");
    expect(() => decryptWebhookUrl(`enc:v1:${parts.join(".")}`)).toThrow("Stored credential could not be decrypted");
    vi.stubEnv("WEBHOOK_ENCRYPTION_SECRET", previous);
    expect(() => encryptWebhookUrl(envelope)).toThrow("Stored credential could not be decrypted");
  });
  it("uses explicit previous keys and rotates only on request", () => {
    vi.stubEnv("WEBHOOK_ENCRYPTION_SECRET", previous);
    const old = encryptWebhookUrl("fake-old-token");
    vi.stubEnv("WEBHOOK_ENCRYPTION_SECRET", active);
    vi.stubEnv("WEBHOOK_ENCRYPTION_PREVIOUS_SECRETS", JSON.stringify([previous]));
    expect(decryptStoredCredential(old)).toBe("fake-old-token");
    expect(encryptWebhookUrl(old)).toBe(old);
    const rotated = rotateStoredCredential(old);
    vi.stubEnv("WEBHOOK_ENCRYPTION_PREVIOUS_SECRETS", "[]");
    expect(decryptWebhookUrl(rotated)).toBe("fake-old-token");
    expect(() => decryptWebhookUrl(old)).toThrow();
  });
  it.each(["not-json", "{}", '["short"]', '[1]', JSON.stringify(Array(4).fill(previous))])("rejects invalid previous-key configuration %s", config => {
    const envelope = encryptWebhookUrl("fake-token");
    vi.stubEnv("WEBHOOK_ENCRYPTION_PREVIOUS_SECRETS", config);
    expect(() => decryptWebhookUrl(envelope)).toThrow("Stored credential could not be decrypted");
  });
  it("preserves the auth-secret fallback but never falls back from a bad explicit key", () => {
    vi.stubEnv("WEBHOOK_ENCRYPTION_SECRET", undefined);
    vi.stubEnv("BETTER_AUTH_SECRET", active);
    expect(decryptWebhookUrl(encryptWebhookUrl("fake-token"))).toBe("fake-token");
    vi.stubEnv("WEBHOOK_ENCRYPTION_SECRET", "short");
    expect(() => encryptWebhookUrl("fake-token")).toThrow("Credential encryption is not configured");
  });
  it("encrypts both fields without mutating input, preserving omitted and null fields", () => {
    const input = { accessToken: "fake-access", refreshToken: "fake-refresh", accountName: "Account" };
    const encrypted = encryptSocialAccountCredentials(input);
    expect(decryptWebhookUrl(encrypted.accessToken)).toBe(input.accessToken);
    expect(decryptWebhookUrl(encrypted.refreshToken)).toBe(input.refreshToken);
    expect(input.accessToken).toBe("fake-access");
    expect(encryptSocialAccountCredentials({ refreshToken: null })).toEqual({ refreshToken: null });
    expect(encryptSocialAccountCredentials({})).toEqual({});
  });
  it.each(["", " ", 42, {}])("rejects invalid credential values %j", accessToken => {
    expect(() => encryptSocialAccountCredentials({ accessToken: accessToken as string })).toThrow();
  });
  it("keeps legacy reads read-only and makes backfill idempotent", () => {
    expect(decryptStoredCredential("legacy-plaintext")).toBe("legacy-plaintext");
    const patch = socialCredentialMigrationPatch({ accessToken: "legacy-plaintext", refreshToken: null });
    expect(decryptWebhookUrl(patch.accessToken!)).toBe("legacy-plaintext");
    expect(socialCredentialMigrationPatch({ accessToken: patch.accessToken!, refreshToken: null })).toEqual({});
  });
  it("rejects historical nested encryption instead of silently preserving it", () => {
    const inner = encryptWebhookUrl("fake-token");
    const iv = Buffer.alloc(12, 9);
    const cipher = crypto.createCipheriv("aes-256-gcm", crypto.createHash("sha256").update(active).digest(), iv);
    const body = Buffer.concat([cipher.update(inner), cipher.final()]);
    const nested = `enc:v1:${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
    expect(() => encryptWebhookUrl(nested)).toThrow("Invalid stored credential");
    expect(() => rotateStoredCredential(nested)).toThrow("Nested credential encryption is not supported");
  });
});