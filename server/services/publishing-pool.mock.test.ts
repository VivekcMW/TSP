import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billingPlans, subscriptions, userProfiles, platformIntegrations, socialAccounts, type Draft } from "@shared/schema";
const { nestedTransaction } = vi.hoisted(() => ({ nestedTransaction: vi.fn() }));
vi.mock("../db", () => ({ db: { transaction: nestedTransaction } }));
import { assertPublishingPolicy } from "./publishing-policy";

// The REAL entitlement service + billing repository run against these already
// acquired transactions. Any fallback to db.transaction is an immediate failure.
function heldTransaction(tenantId: string, active = true) {
  const queried: unknown[] = [];
  const rows = new Map<unknown, unknown[]>([
    [billingPlans, [{ id: "pro", key: "pro_monthly", name: "Pro", isActive: true }]],
    [subscriptions, [{ tenantId, planId: "pro", status: active ? "active" : "cancelled", currentPeriodStart: new Date(Date.now() - 60000), currentPeriodEnd: new Date(Date.now() + 60000) }]],
    [userProfiles, [{ enabledPlatforms: ["mastodon"], requirePublishReview: false }]],
    [platformIntegrations, [{ key: "mastodon", enabled: true }]],
    [socialAccounts, [{ provider: "mastodon", isActive: true, providerAccountId: "https://instance.test", accessToken: "test-only-token", scopes: [] }]],
  ]);
  const select = () => ({ from(table: unknown) {
    queried.push(table);
    const result = Object.assign(Promise.resolve(rows.get(table) ?? []), { where: () => result, orderBy: () => result });
    return result;
  } });
  return { transaction: { select } as unknown as Parameters<typeof assertPublishingPolicy>[0], queried };
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("PUBLISHING_MODE", "sandbox");
  nestedTransaction.mockImplementation(() => { throw new Error("Pool exhausted: nested acquisition forbidden"); });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No provider calls permitted"); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("publishing reuses its two held connections", () => {
  it.each(["publish", "schedule"] as const)("completes two concurrent %s policies without nested acquisition", async intent => {
    const held = [heldTransaction("one"), heldTransaction("two")];
    let acquired = 0, release!: () => void;
    const bothAcquired = new Promise<void>(resolve => { release = resolve; });
    await Promise.all(held.map(async ({ transaction }, index) => {
      if (++acquired === 2) release();
      await bothAcquired;
      const scope = { tenantId: index === 0 ? "one" : "two", userId: "owner" };
      const draft = { ...scope, content: "A test post", media: [] } as unknown as Draft;
      await assertPublishingPolicy(transaction, scope, draft, ["mastodon"], intent, "sandbox");
    }));
    expect(nestedTransaction).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    for (const { queried } of held) {
      expect(queried.filter(table => table === subscriptions)).toHaveLength(intent === "schedule" ? 2 : 1);
      expect(queried.filter(table => table === billingPlans)).toHaveLength(intent === "schedule" ? 2 : 1);
    }
  });
  it("still denies an inactive subscription using the held transaction", async () => {
    const scope = { tenantId: "one", userId: "owner" };
    await expect(assertPublishingPolicy(heldTransaction("one", false).transaction, scope, { ...scope } as Draft, ["mastodon"], "schedule", "sandbox"))
      .rejects.toMatchObject({ statusCode: 403, code: "entitlement_required" });
    expect(nestedTransaction).not.toHaveBeenCalled();
  });
});