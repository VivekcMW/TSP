import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Draft } from "@shared/schema";
const { entitlement, decrypt, assess, EntitlementError } = vi.hoisted(() => ({ entitlement: vi.fn(), decrypt: vi.fn(), assess: vi.fn(), EntitlementError: class extends Error { code = "entitlement_required"; } }));
vi.mock("./entitlements", () => ({ assertTenantEntitlement: entitlement, EntitlementError }));
vi.mock("./webhookSecrets", () => ({ decryptStoredCredential: decrypt }));
vi.mock("./publishers/providerLifecycle", () => ({ assessProviderConnection: assess }));
import { assertPublishingPolicy, reviewFingerprint, configuredPublishingMode } from "./publishing-policy";
const scope = { tenantId: "tenant", userId: "owner" };
const draft = { ...scope, id: "draft", content: "Reviewed content", media: [], platformPublishRules: {}, publishApprovedAt: new Date() } as unknown as Draft;
draft.publishApprovalHash = reviewFingerprint(draft);
function tx(rows: unknown[][]) {
  const where = vi.fn(); rows.forEach(row => where.mockResolvedValueOnce(row));
  return { select: () => ({ from: () => ({ where }) }) } as unknown as Parameters<typeof assertPublishingPolicy>[0];
}
const profile = { enabledPlatforms: ["reddit"], requirePublishReview: true };
const account = { providerAccountId: "id", accessToken: "encrypted" };
function allowedRows() { return [[profile], [{ key: "reddit", enabled: true }], [], [account]]; }
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("PUBLISHING_MODE", "sandbox"); entitlement.mockResolvedValue({}); decrypt.mockReturnValue("credential"); assess.mockReturnValue({ canPublish: true }); });
afterEach(() => vi.unstubAllEnvs());
describe("common admission and execution policy", () => {
  it("delegates plan semantics to authoritative entitlement service", async () => {
    const transaction = tx(allowedRows());
    await assertPublishingPolicy(transaction, scope, draft, ["reddit"], "schedule", "sandbox");
    expect(entitlement.mock.calls).toEqual([["tenant", "publish", { transaction }], ["tenant", "schedule", { transaction }]]);
  });
  it("does not invent a schedule denial for publish-now", async () => {
    const transaction = tx(allowedRows());
    await assertPublishingPolicy(transaction, scope, draft, ["reddit"], "publish", "sandbox");
    expect(entitlement.mock.calls).toEqual([["tenant", "publish", { transaction }]]);
  });
  it("fails closed on entitlement denial and resolver outage", async () => {
    entitlement.mockRejectedValueOnce(new EntitlementError("Not entitled")).mockRejectedValueOnce(new Error("secret DB details"));
    await expect(assertPublishingPolicy(tx([]), scope, draft, ["reddit"], "publish", "sandbox")).rejects.toMatchObject({ statusCode: 403, code: "entitlement_required" });
    await expect(assertPublishingPolicy(tx([]), scope, draft, ["reddit"], "publish", "sandbox")).rejects.toMatchObject({ statusCode: 503, message: "Plan access could not be verified. Try again later." });
  });
  it("rejects stale review after content change", async () => {
    await expect(assertPublishingPolicy(tx(allowedRows()), scope, { ...draft, content: "Changed" }, ["reddit"], "publish", "sandbox")).rejects.toThrow("exact draft");
  });
  it.each([false, undefined])("requires explicit global integration enablement: %s", async enabled => {
    await expect(assertPublishingPolicy(tx([[profile], enabled === undefined ? [] : [{ key: "reddit", enabled }]]), scope, draft, ["reddit"], "publish", "sandbox")).rejects.toThrow("globally");
  });
  it("rejects preferences and disabled per-platform rule", async () => {
    await expect(assertPublishingPolicy(tx([[{ ...profile, enabledPlatforms: [] }], [{ key: "reddit", enabled: true }]]), scope, draft, ["reddit"], "publish", "sandbox")).rejects.toThrow("preferences");
    await expect(assertPublishingPolicy(tx([[profile], [{ key: "reddit", enabled: true }], [{ enabled: false }]]), scope, draft, ["reddit"], "publish", "sandbox")).rejects.toThrow("rule");
  });
  it("rejects content outside rule bounds", async () => {
    await expect(assertPublishingPolicy(tx([[profile], [{ key: "reddit", enabled: true }], [{ minCharacters: 100 }]]), scope, draft, ["reddit"], "publish", "sandbox")).rejects.toThrow("character limits");
  });
  it("rejects Reddit attachments instead of dropping them", async () => {
    const attached = { ...draft, media: [{ id: "asset", type: "image" as const, name: "image", url: "/media" }] };
    attached.publishApprovalHash = reviewFingerprint(attached);
    await expect(assertPublishingPolicy(tx(allowedRows()), scope, attached, ["reddit"], "publish", "sandbox")).rejects.toThrow("media");
  });
  it("rejects credential decryption failures", async () => {
    decrypt.mockImplementation(() => { throw new Error("secret"); });
    await expect(assertPublishingPolicy(tx(allowedRows()), scope, draft, ["reddit"], "publish", "sandbox")).rejects.toThrow("Reconnect");
  });
  it.each([undefined, { contentType: "video/mp4", sizeBytes: 10 }, { contentType: "image/png", sizeBytes: 6 * 1024 * 1024 }, { contentType: "image/png", sizeBytes: 10, deletionRequestedAt: new Date() }])("rejects missing, mismatched, oversized or deleting owned media: %j", async asset => {
    const attached = { ...draft, media: [{ id: "asset", type: "image" as const, name: "Image", url: "/media" }] };
    attached.publishApprovalHash = reviewFingerprint(attached);
    const rows = [[{ ...profile, enabledPlatforms: ["linkedin"] }], [{ key: "linkedin", enabled: true }], [], asset ? [asset] : []];
    await expect(assertPublishingPolicy(tx(rows), scope, attached, ["linkedin"], "publish", "sandbox")).rejects.toThrow("unavailable or unsupported");
  });
  it("rejects tenant mismatch, duplicate targets and changed execution mode", async () => {
    await expect(assertPublishingPolicy(tx([]), { ...scope, userId: "other" }, draft, ["reddit"], "publish", "sandbox")).rejects.toThrow("unavailable");
    await expect(assertPublishingPolicy(tx([]), scope, draft, ["reddit", "reddit"], "publish", "sandbox")).rejects.toThrow("distinct");
    await expect(assertPublishingPolicy(tx([]), scope, draft, ["reddit"], "publish", "live")).rejects.toThrow("mode changed");
    vi.stubEnv("PUBLISHING_MODE", "typo"); expect(() => configuredPublishingMode()).toThrow("unavailable");
  });
});