import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { emailDeliveries, emailPreferences, mediaAssets, tenantMembers, tenants, users } from "@shared/schema";

// Parent-coordinated ONLY: does not load dotenv, create databases, or apply 0034.
// Both URLs must explicitly name disposable test databases. No imports open a
// database pool unless this separate opt-in is present.
const enabled = process.env.NOTIFICATIONS_MEDIA_DB_TESTS === "true";
vi.mock("resend", () => ({ Resend: class { constructor() { throw new Error("Live email forbidden in DB tests"); } } }));
vi.mock("@aws-sdk/client-s3", () => ({ S3Client: class { constructor() { throw new Error("Live object store forbidden in DB tests"); } } }));

describe.skipIf(!enabled)("notifications/media PostgreSQL integration (0034 prerequisite)", () => {
  let application: typeof import("./db");
  let owner: typeof import("../test/db-owner");
  let repository: typeof import("./storage").storage;
  let preferences: typeof import("./services/email/preferences");
  let delivery: typeof import("./services/email/delivery-store");
  const userIds = [randomUUID(), randomUUID()]; const tenantIds = [randomUUID(), randomUUID(), randomUUID()];
  const scope = { tenantId: tenantIds[0], userId: userIds[0] };
  let fixturesStarted = false;
  const media = () => { const id = randomUUID(); return { id, fileName: "test.png", contentType: "image/png", sizeBytes: 8, storageKey: `${scope.tenantId}/${scope.userId}/${id}` }; };
  const message = (key: string) => ({ type: "daily_digest" as const, userId: userIds[0], recipient: "fixture@example.invalid", subject: "Test", html: "", dedupeKey: key });

  beforeAll(async () => {
    for (const key of ["DATABASE_URL", "OWNER_TEST_DATABASE_URL"]) {
      const value = process.env[key];
      if (!value || !/test/i.test(new URL(value).pathname)) throw new Error("Explicit disposable test database URLs required");
    }
    if (process.env.RESEND_API_KEY) throw new Error("Remove provider credentials from DB test environment");
    vi.stubGlobal("fetch", () => { throw new Error("External fetch forbidden in DB tests"); });
    application = await import("./db"); owner = await import("../test/db-owner");
    const role = await application.pool.query("select rolsuper, rolbypassrls from pg_roles where rolname = current_user");
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    // Fail, never auto-migrate, when the parent has not applied 0034.
    await application.pool.query("select claim_token, lease_until, attempts from email_deliveries limit 0");
    await application.pool.query("select storage_backend, storage_location, deletion_requested_at from media_assets limit 0");
    await application.pool.query("select digest_timezone, publishing from email_preferences limit 0");
    repository = (await import("./storage")).storage;
    preferences = await import("./services/email/preferences"); delivery = await import("./services/email/delivery-store");
    fixturesStarted = true;
    await owner.ownerDb.transaction(async tx => {
      await tx.insert(users).values(userIds.map(id => ({ id, email: `${id}@example.invalid`, name: "Notification/media test" })));
      await tx.insert(tenants).values(tenantIds.map(id => ({ id, name: "Notification/media isolated fixture" })));
      await tx.insert(tenantMembers).values(tenantIds.flatMap(tenantId => userIds.map(userId => ({ tenantId, userId, role: "owner" }))));
    });
  });
  afterAll(async () => {
    try {
      if (fixturesStarted) await owner.ownerDb.transaction(async tx => {
        for (const tenantId of tenantIds) {
          await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
          await tx.delete(mediaAssets).where(and(eq(mediaAssets.tenantId, tenantId), inArray(mediaAssets.userId, userIds)));
        }
        await tx.delete(emailDeliveries).where(inArray(emailDeliveries.userId, userIds));
        await tx.delete(emailPreferences).where(inArray(emailPreferences.userId, userIds));
        await tx.delete(tenantMembers).where(and(inArray(tenantMembers.tenantId, tenantIds), inArray(tenantMembers.userId, userIds)));
        await tx.delete(tenants).where(inArray(tenants.id, tenantIds));
        await tx.delete(users).where(inArray(users.id, userIds));
      });
    } finally { await owner?.ownerPool.end(); await application?.pool.end(); vi.unstubAllGlobals(); }
  });

  it("concurrent partial upserts preserve independent category intent", async () => {
    await Promise.all([preferences.updateEmailPreferences(userIds[0], { marketing: false }), preferences.updateEmailPreferences(userIds[0], { dailyDigest: false })]);
    expect(await preferences.getEmailPreferences(userIds[0])).toMatchObject({ marketing: false, dailyDigest: false, publishing: true });
    await preferences.updateEmailPreferences(userIds[0], { unsubscribeAll: true });
    expect(await preferences.updateEmailPreferences(userIds[0], { publishing: true })).toMatchObject({ marketing: false, dailyDigest: false, publishing: true, unsubscribedAt: null });
    expect(await preferences.getEmailPreferences(userIds[1])).toMatchObject({ marketing: true, dailyDigest: true });
  });
  it("only one concurrent worker can claim a durable slot", async () => {
    const email = message(randomUUID());
    const claims = await Promise.allSettled(Array.from({ length: 8 }, () => delivery.claimDelivery(email)));
    expect(claims.filter(result => result.status === "fulfilled" && result.value)).toHaveLength(1);
    const rows = await application.db.select().from(emailDeliveries).where(eq(emailDeliveries.dedupeKey, delivery.deliveryKey(email)!));
    expect(rows).toHaveLength(1); expect(rows[0].attempts).toBe(1);
  });
  it("reclaims pre-dispatch expiry with a new fence but never unknown dispatch", async () => {
    const email = message(randomUUID()); const first = (await delivery.claimDelivery(email))!;
    await application.db.update(emailDeliveries).set({ leaseUntil: new Date(0) }).where(eq(emailDeliveries.id, first.id));
    const second = (await delivery.claimDelivery(email))!;
    expect(second.token).not.toBe(first.token); expect(await delivery.beginDelivery(first)).toBe(false);
    expect(await delivery.beginDelivery(second)).toBe(true);
    await application.db.update(emailDeliveries).set({ leaseUntil: new Date(0) }).where(eq(emailDeliveries.id, second.id));
    expect(await delivery.claimDelivery(email)).toBeUndefined();
    const [row] = await application.db.select().from(emailDeliveries).where(eq(emailDeliveries.id, second.id));
    expect(row.status).toBe("unknown");
  });
  it("sent receipts remain deduplicated across worker restarts", async () => {
    const email = message(randomUUID()); const claim = (await delivery.claimDelivery(email))!;
    await delivery.beginDelivery(claim); await delivery.finishDelivery(claim, "sent", "mock-provider-receipt");
    expect(await delivery.claimDelivery(email)).toBeUndefined();
  });
  it("isolates media across users and across tenants for the same user", async () => {
    const asset = await repository.createMediaAsset(scope, media());
    for (const foreign of [{ ...scope, tenantId: tenantIds[1] }, { ...scope, userId: userIds[1] }]) {
      expect(await repository.getMediaAsset(foreign, asset.id)).toBeUndefined();
      await repository.requestMediaDeletion(foreign, asset.id); await repository.deleteMediaAsset(foreign, asset.id);
    }
    expect(await repository.getMediaAsset(scope, asset.id)).toMatchObject({ deletionRequestedAt: null });
    await application.db.transaction(async tx => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantIds[1]}, true)`);
      expect(await tx.select().from(mediaAssets).where(eq(mediaAssets.id, asset.id))).toHaveLength(0);
    });
    await repository.requestMediaDeletion(scope, asset.id);
    expect((await repository.getMediaAsset(scope, asset.id))?.deletionRequestedAt).toBeInstanceOf(Date);
    await repository.deleteMediaAsset(scope, asset.id); await repository.deleteMediaAsset(scope, asset.id);
  });
  it("enforces the 200-asset cap even for concurrent writers", async () => {
    const capped = { tenantId: tenantIds[2], userId: userIds[0] };
    await owner.ownerDb.transaction(async tx => {
      await tx.execute(sql`select set_config('app.tenant_id', ${capped.tenantId}, true)`);
      await tx.insert(mediaAssets).values(Array.from({ length: 199 }, () => ({ ...media(), ...capped })));
    });
    const results = await Promise.allSettled([repository.createMediaAsset(capped, media()), repository.createMediaAsset(capped, media())]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  });
});