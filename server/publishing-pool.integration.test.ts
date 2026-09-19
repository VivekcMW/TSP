import { randomUUID } from "node:crypto";
import { requireLocalTestDatabase } from "../test/database-safety";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { billingCustomers, billingPlans, drafts, platformIntegrations, socialAccounts, subscriptions, tenantMembers, tenants, userProfiles, users } from "@shared/schema";

// Parent-only: existing migrated local schema/catalog, no migrations and no
// provider effects. No DB module is imported unless explicitly opted in.
describe.skipIf(process.env.PUBLISHING_POOL_DB_TESTS !== "true")("publishing with two PostgreSQL pool slots", () => {
  let app: typeof import("./db");
  let policy: typeof import("./services/publishing-policy");
  let encrypt: typeof import("./services/webhookSecrets").encryptWebhookUrl;
  let proId: string;
  beforeAll(async () => {
    requireLocalTestDatabase();
    vi.stubEnv("DB_POOL_MAX", "2"); vi.stubEnv("DB_CONNECTION_TIMEOUT_MS", "1000");
    vi.stubEnv("PUBLISHING_MODE", "sandbox");
    vi.stubEnv("WEBHOOK_ENCRYPTION_SECRET", "publishing-pool-test-only-key-32-characters");
    vi.stubEnv("WEBHOOK_ENCRYPTION_PREVIOUS_SECRETS", "[]");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Provider calls forbidden"); }));
    app = await import("./db"); policy = await import("./services/publishing-policy");
    encrypt = (await import("./services/webhookSecrets")).encryptWebhookUrl;
    expect(app.pool.options.max).toBe(2);
    const role = await app.pool.query("select rolsuper, rolbypassrls from pg_roles where rolname=current_user");
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const [plan] = await app.db.select().from(billingPlans).where(and(eq(billingPlans.key, "pro_monthly"), eq(billingPlans.isActive, true)));
    const [integration] = await app.db.select().from(platformIntegrations).where(eq(platformIntegrations.key, "mastodon"));
    if (!plan || !integration?.enabled) throw new Error("Existing active pro_monthly plan and enabled Mastodon integration required; no global catalog changes performed");
    proId = plan.id;
  });
  afterAll(async () => { await app?.pool.end(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it.each(["publish", "schedule"] as const)("finishes simultaneous %s policies under draft locks without acquiring slot three", async intent => {
    const rollback = new Error("fixture rollback");
    let arrivals = 0, release!: () => void;
    const bothHeld = new Promise<void>(resolve => { release = resolve; });
    const timer = setTimeout(release, 3000); // Release peer even if fixture setup fails.
    const pids = new Set<unknown>();
    let completed = 0;
    try {
      const results = await Promise.allSettled(Array.from({ length: 2 }, () => app.db.transaction(async tx => {
        const scope = { tenantId: randomUUID(), userId: randomUUID() };
        await tx.execute(sql`select set_config('app.tenant_id', ${scope.tenantId}, true)`);
        // Every fixture lives in this transaction and rolls back even on failure.
        await tx.insert(tenants).values({ id: scope.tenantId, name: "Pool regression" });
        await tx.insert(users).values({ id: scope.userId, email: `${scope.userId}@example.invalid` });
        await tx.insert(tenantMembers).values({ ...scope, role: "owner" });
        await tx.insert(userProfiles).values({ ...scope, enabledPlatforms: ["mastodon"], requirePublishReview: false });
        const [customer] = await tx.insert(billingCustomers).values({ tenantId: scope.tenantId, razorpayCustomerId: `mock_${randomUUID()}`, email: "pool@example.invalid", name: "Pool test" }).returning();
        await tx.insert(subscriptions).values({ tenantId: scope.tenantId, billingCustomerId: customer.id, planId: proId, status: "active", currentPeriodStart: new Date(Date.now() - 60000), currentPeriodEnd: new Date(Date.now() + 60000) });
        await tx.insert(socialAccounts).values({ ...scope, provider: "mastodon", providerAccountId: "https://instance.test", accessToken: encrypt("test-only-token"), scopes: [], isActive: true });
        const [created] = await tx.insert(drafts).values({ ...scope, platform: "mastodon", tone: "professional", content: "Pool regression post" }).returning();
        const [draft] = await tx.select().from(drafts).where(eq(drafts.id, created.id)).for("update");
        pids.add((await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0].pid);
        if (++arrivals === 2) release();
        await bothHeld;
        expect(arrivals).toBe(2);
        expect(app.pool.totalCount).toBe(2); expect(app.pool.idleCount).toBe(0);
        await policy.assertPublishingPolicy(tx, scope, draft, ["mastodon"], intent, "sandbox");
        completed++;
        throw rollback;
      })));
      expect(results).toEqual([{ status: "rejected", reason: rollback }, { status: "rejected", reason: rollback }]);
      expect(completed).toBe(2); expect(pids.size).toBe(2); expect(app.pool.waitingCount).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
    } finally { clearTimeout(timer); release(); }
  }, 10000);

  it("times out queued acquisition while both slots are held and removes the waiter", async () => {
    const first = await app.pool.connect();
    let second: PoolClient | undefined;
    try {
      second = await app.pool.connect();
      await expect(app.pool.connect()).rejects.toThrow(/timeout/i);
      expect(app.pool.waitingCount).toBe(0);
    } finally { second?.release(); first.release(); }
    const recovered = await app.pool.connect(); recovered.release();
  }, 5000);
});