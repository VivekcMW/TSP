import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { requireLocalTestDatabase } from "../../test/database-safety";
import { captureTokens, inboundAddresses, inboundMessages, tenantMembers, tenants, users, type CaptureToken } from "@shared/schema";
import type { TenantScope } from "../storage";

// Opt-in AFTER migration 0064 is applied to the explicit local test database (runs as the restricted tsp_app role).
const enabled = process.env.INPUTS_DB_TESTS === "true";

describe.skipIf(!enabled)("external inputs PostgreSQL repository (0064 prerequisite)", () => {
  let app: typeof import("../db");
  let owner: typeof import("../../test/db-owner");
  let repo: typeof import("./inputs");
  let hashOf: typeof import("../services/captureTokens").hashSecretToken;
  const tenantIds: string[] = [], userIds: string[] = [];
  let scope: TenantScope;

  async function makeScope(): Promise<TenantScope> {
    const userId = randomUUID(), tenantId = randomUUID();
    await owner.ownerDb.insert(users).values({ id: userId, email: `${userId}@inputs.test` });
    await owner.ownerDb.insert(tenants).values({ id: tenantId, kind: "corporate", name: "Inputs fixture" });
    await owner.ownerDb.insert(tenantMembers).values({ tenantId, userId, role: "member" });
    userIds.push(userId); tenantIds.push(tenantId);
    return { tenantId, userId };
  }
  const secret = (token = randomUUID()) => ({ hash: hashOf(token), hint: "ab12", token });

  beforeAll(async () => {
    const target = requireLocalTestDatabase();
    app = await import("../db");
    owner = await import("../../test/db-owner");
    repo = await import("./inputs");
    hashOf = (await import("../services/captureTokens")).hashSecretToken;
    expect((await app.pool.query("select current_user, current_database(), rolbypassrls, rolsuper from pg_roles where rolname = current_user")).rows[0])
      .toEqual({ current_user: "tsp_app", current_database: target.database, rolbypassrls: false, rolsuper: false });
    const ready = await app.pool.query("select to_regclass('public.inbound_addresses') is not null and to_regclass('public.capture_tokens') is not null as ready");
    expect(ready.rows[0].ready).toBe(true);
  });
  beforeEach(async () => { scope = await makeScope(); });
  afterEach(async () => {
    if (tenantIds.length) {
      for (const table of [inboundMessages, inboundAddresses, captureTokens]) await owner.ownerDb.delete(table).where(inArray(table.tenantId, tenantIds));
      await owner.ownerDb.delete(tenantMembers).where(inArray(tenantMembers.tenantId, tenantIds));
      await owner.ownerDb.delete(tenants).where(inArray(tenants.id, tenantIds));
    }
    if (userIds.length) await owner.ownerDb.delete(users).where(inArray(users.id, userIds));
    tenantIds.length = 0; userIds.length = 0;
  });
  afterAll(async () => { await owner?.ownerPool.end(); await app?.pool.end(); });

  it("resolves an address by token hash without a tenant, and nothing else is readable that way", async () => {
    const first = secret(), other = secret();
    const otherScope = await makeScope();
    const { address, created } = await repo.createInboundAddress(scope, first);
    await repo.createInboundAddress(otherScope, other);
    expect(created).toBe(true);
    expect(await repo.resolveInboundAddress(first.hash)).toEqual({ id: address.id, ...scope });
    expect(await repo.resolveInboundAddress(hashOf("unknown"))).toBeUndefined();
    expect(await repo.resolveInboundAddress("not-a-hash")).toBeUndefined();
    // As tsp_app with no settings at all, forced RLS hides every row.
    expect((await app.pool.query("select count(*)::int as n from inbound_addresses")).rows[0].n).toBe(0);
    // The lookup setting exposes exactly the matching row, even with an unrelated tenant set.
    const client = await app.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("select set_config('app.tenant_id', $1, true), set_config('app.inbound_token_hash', $2, true)", [randomUUID(), first.hash]);
      expect((await client.query("select tenant_id from inbound_addresses")).rows).toEqual([{ tenant_id: scope.tenantId }]);
      expect((await client.query("update inbound_addresses set disabled = true where token_hash = $1", [first.hash])).rowCount).toBe(0);
      await client.query("ROLLBACK");
    } finally { client.release(); }
  });

  it("keeps one address per member, rotates the token and stops resolving when disabled", async () => {
    const first = secret(), second = secret(), third = secret();
    const { address } = await repo.createInboundAddress(scope, first);
    const again = await repo.createInboundAddress(scope, second);
    expect(again).toMatchObject({ created: false, address: { id: address.id, tokenHash: first.hash } });
    const rotated = await repo.replaceInboundAddressToken(scope, { ...third, encrypted: "enc:v1:fixture" });
    expect(rotated).toMatchObject({ id: address.id, tokenHash: third.hash, tokenEncrypted: "enc:v1:fixture", disabled: false });
    expect(rotated!.rotatedAt).toBeInstanceOf(Date);
    expect(await repo.resolveInboundAddress(first.hash)).toBeUndefined();
    expect(await repo.resolveInboundAddress(third.hash)).toMatchObject(scope);
    expect(await repo.disableInboundAddress(scope)).toBe(true);
    expect(await repo.resolveInboundAddress(third.hash)).toBeUndefined();
    expect(await repo.getInboundAddress(await makeScope())).toBeUndefined();
  });

  it("dedupes by Message-ID, limits messages per day and lists recent ones newest first", async () => {
    const message = { messageId: "issue-1@news.site.com", fromAddress: "editor@news.site.com", fromName: "News", subject: "Issue 1" };
    const reserved = await repo.reserveInboundMessage(scope, message);
    expect(reserved.outcome).toBe("reserved");
    expect(await repo.reserveInboundMessage(scope, message)).toEqual({ outcome: "duplicate" });
    // Another member may receive the same newsletter.
    expect((await repo.reserveInboundMessage(await makeScope(), message)).outcome).toBe("reserved");
    await repo.finishInboundMessage(scope, (reserved as { id: string }).id, { status: "processed", linksFound: 4, itemsCreated: 3 });
    await owner.ownerDb.insert(inboundMessages).values(Array.from({ length: repo.INBOUND_DAILY_MESSAGE_LIMIT - 1 }, (_, i) => ({
      ...scope, messageId: `bulk-${i}`, status: "processed" as const, receivedAt: new Date(Date.now() - 1000 * (i + 1)),
    })));
    expect(await repo.reserveInboundMessage(scope, { ...message, messageId: "one-too-many" })).toEqual({ outcome: "rate_limited" });
    await owner.ownerDb.update(inboundMessages).set({ receivedAt: sql`now() - interval '2 days'` }).where(inArray(inboundMessages.messageId, ["bulk-0", "bulk-1"]));
    expect((await repo.reserveInboundMessage(scope, { ...message, messageId: "next-day" })).outcome).toBe("reserved");
    const recent = await repo.listInboundMessages(scope, 3);
    expect(recent.map(row => row.messageId)).toEqual(["next-day", "issue-1@news.site.com", "bulk-2"]);
    expect(recent[1]).toMatchObject({ status: "processed", linksFound: 4, itemsCreated: 3 });
  });

  it("releases only an unfinished reservation", async () => {
    const reserved = await repo.reserveInboundMessage(scope, { messageId: "retry-me", fromAddress: null, fromName: null, subject: null });
    await repo.releaseInboundMessage(scope, (reserved as { id: string }).id);
    expect((await repo.reserveInboundMessage(scope, { messageId: "retry-me", fromAddress: null, fromName: null, subject: null })).outcome).toBe("reserved");
  });

  it("caps active capture keys at five, revokes them and resolves only active keys", async () => {
    const keys: CaptureToken[] = [];
    for (let i = 0; i < repo.CAPTURE_TOKEN_LIMIT; i++) keys.push(await repo.createCaptureToken(scope, secret(), `Key ${i}`));
    await expect(repo.createCaptureToken(scope, secret(), "Sixth")).rejects.toBeInstanceOf(repo.CaptureTokenLimitError);
    const other = await makeScope();
    expect(await repo.revokeCaptureToken(other, keys[0].id)).toBe(false);
    expect(await repo.revokeCaptureToken(scope, keys[0].id)).toBe(true);
    expect(await repo.revokeCaptureToken(scope, keys[0].id)).toBe(false);
    expect(await repo.resolveCaptureToken(keys[0].tokenHash)).toBeUndefined();
    expect(await repo.resolveCaptureToken(keys[1].tokenHash)).toEqual({ id: keys[1].id, ...scope });
    expect((await repo.listCaptureTokens(scope)).map(key => key.id)).not.toContain(keys[0].id);
    expect(await repo.listCaptureTokens(other)).toEqual([]);
    await repo.createCaptureToken(scope, secret(), "Replacement");
    await repo.touchCaptureToken(scope, keys[1].id);
    expect((await repo.listCaptureTokens(scope)).find(key => key.id === keys[1].id)!.lastUsedAt).toBeInstanceOf(Date);
  });
});
