import { randomUUID } from "node:crypto";
import { requireLocalTestDatabase } from "../../test/database-safety";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { pool } from "../db";
import { ownerPool } from "../../test/db-owner";
import { editorialVoiceRepository as repository, VoiceConflict, VoiceNotFound } from "./editorialVoice";
import { voicePromptData, type VoiceScope } from "@shared/editorial-voice";

// Unique fixtures only. Never truncate/delete shared users, tenants, drafts or inbox.
const prefix = `voice-${randomUUID()}`;
const a = { tenantId: `${prefix}-a`, userId: `${prefix}-u1` };
const sameTenant = { tenantId: a.tenantId, userId: `${prefix}-u2` };
const otherTenant = { tenantId: `${prefix}-b`, userId: a.userId };
const text = "A measured, explicitly approved writing sample.";
const add = (revision = 0) => ({ action: "add", revision, text, origin: "explicit-sample", consent: true });
beforeAll(async () => {
  const target = requireLocalTestDatabase();
  const identity = await pool.query("SELECT current_database() AS db, current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
  expect(identity.rows[0]).toMatchObject({ db: target.database, role: "tsp_app", rolsuper: false, rolbypassrls: false });
  expect((await ownerPool.query("SELECT current_database() AS db")).rows[0].db).toBe(target.database);
  await ownerPool.query("INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)", [a.userId, `${a.userId}@example.invalid`, sameTenant.userId, `${sameTenant.userId}@example.invalid`]);
  await ownerPool.query("INSERT INTO tenants (id, kind, name) VALUES ($1, 'personal', 'Voice test A'), ($2, 'personal', 'Voice test B')", [a.tenantId, otherTenant.tenantId]);
});
beforeEach(async () => { await ownerPool.query("DELETE FROM editorial_voices WHERE tenant_id = ANY($1::varchar[])", [[a.tenantId, otherTenant.tenantId]]); });
afterAll(async () => {
  try {
    await ownerPool.query("DELETE FROM tenants WHERE id = ANY($1::varchar[])", [[a.tenantId, otherTenant.tenantId]]);
    await ownerPool.query("DELETE FROM users WHERE id = ANY($1::varchar[])", [[a.userId, sameTenant.userId]]);
  } finally { await pool.end(); await ownerPool.end(); }
});
async function raw(scope: VoiceScope | undefined, query: string, values: unknown[] = []) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (scope) await client.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [scope.tenantId, scope.userId]);
    return await client.query(query, values);
  } finally { await client.query("ROLLBACK"); client.release(); }
}

describe("voice dedicated repository and actual tenant/user RLS", () => {
  it("starts disabled, persists explicit consent, edits, deletes, restores, and forgets", async () => {
    expect(await repository.get(a)).toEqual({ enabled: false, revision: 0, samples: [] });
    let voice = await repository.mutate(a, add());
    const id = voice.samples[0].id;
    expect(voice.enabled).toBe(false); expect(voice.samples[0].approvedAt).toBeTruthy();
    voice = await repository.mutate(a, { action: "enable", revision: 1, enabled: true, consent: true });
    expect(voicePromptData(voice)?.samples).toEqual([{ text }]);
    voice = await repository.mutate(a, { action: "edit", revision: 2, id, text: text + " Edited.", consent: true });
    expect(voice.samples[0].text).toBe(text + " Edited.");
    voice = await repository.mutate(a, { action: "delete", revision: 3, id });
    expect(voicePromptData(voice)).toBeUndefined();
    expect((await repository.get(a)).samples[0].deletedAt).toBeTruthy();
    await expect(repository.mutate(a, { action: "restore", revision: 4, id })).rejects.toThrow();
    voice = await repository.mutate(a, { action: "restore", revision: 4, id, consent: true });
    expect(voicePromptData(voice)?.samples[0].text).toContain("Edited");
    await repository.mutate(a, { action: "delete", revision: 5, id });
    voice = await repository.mutate(a, { action: "forget", revision: 6, id, confirm: true });
    expect(voice.samples).toEqual([]);
    expect((await ownerPool.query("SELECT id FROM editorial_voice_samples WHERE id = $1", [id])).rows).toEqual([]);
    await expect(repository.mutate(a, { action: "restore", revision: 7, id, consent: true })).rejects.toBeInstanceOf(VoiceNotFound);
  });
  it("isolates both other users in the same tenant and the same user in another tenant", async () => {
    const voice = await repository.mutate(a, add());
    for (const scope of [sameTenant, otherTenant]) {
      expect((await repository.get(scope)).samples).toEqual([]);
      await expect(repository.mutate(scope, { action: "delete", revision: 0, id: voice.samples[0].id })).rejects.toBeInstanceOf(VoiceNotFound);
      await expect(repository.mutate(scope, { action: "edit", revision: 0, id: voice.samples[0].id, text: "An attempted foreign sample edit.", consent: true })).rejects.toBeInstanceOf(VoiceNotFound);
    }
    expect((await repository.get(a)).samples[0].deletedAt).toBeNull();
    expect((await ownerPool.query("SELECT text FROM editorial_voice_samples WHERE id = $1", [voice.samples[0].id])).rows[0].text).toBe(text);
  });
  it("RLS protects predicate-free SELECT, UPDATE, DELETE and scope spoofing", async () => {
    await repository.mutate(a, add());
    for (const scope of [undefined, sameTenant, otherTenant]) {
      expect((await raw(scope, "SELECT * FROM editorial_voice_samples")).rows).toEqual([]);
      expect((await raw(scope, "UPDATE editorial_voice_samples SET text = 'Attempted unauthorized replacement'")).rowCount).toBe(0);
      expect((await raw(scope, "DELETE FROM editorial_voice_samples")).rowCount).toBe(0);
      expect((await raw(scope, "SELECT * FROM editorial_voices")).rows).toEqual([]);
    }
    await expect(raw(sameTenant, "INSERT INTO editorial_voices (tenant_id, user_id) VALUES ($1, $2)", [otherTenant.tenantId, a.userId])).rejects.toMatchObject({ code: "42501" });
    await expect(raw(a, "UPDATE editorial_voice_samples SET user_id = $1", [sameTenant.userId])).rejects.toMatchObject({ code: "42501" });
    expect((await raw(a, "SELECT * FROM editorial_voice_samples")).rows).toHaveLength(1);
    // Transaction-local identity must not leak when the connection returns to pool.
    expect((await raw(undefined, "SELECT * FROM editorial_voice_samples")).rows).toEqual([]);
  });
  it("enforces five slots including reversible deletions and accepts a slot after forgetting", async () => {
    for (let i = 0; i < 5; i++) await repository.mutate(a, add(i));
    await expect(repository.mutate(a, add(5))).rejects.toBeInstanceOf(VoiceConflict);
    const id = (await repository.get(a)).samples[0].id;
    await repository.mutate(a, { action: "delete", revision: 5, id });
    await expect(repository.mutate(a, add(6))).rejects.toBeInstanceOf(VoiceConflict);
    await repository.mutate(a, { action: "forget", revision: 6, id, confirm: true });
    expect((await repository.mutate(a, add(7))).samples).toHaveLength(5);
  });
  it("serializes concurrent changes and refuses stale resurrection", async () => {
    await repository.mutate(a, add());
    const outcomes = await Promise.allSettled([repository.mutate(a, add(1)), repository.mutate(a, add(1))]);
    expect(outcomes.filter(value => value.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(value => value.status === "rejected")).toHaveLength(1);
    const voice = await repository.get(a);
    const id = voice.samples[0].id;
    await repository.mutate(a, { action: "delete", revision: voice.revision, id });
    await expect(repository.mutate(a, { action: "edit", revision: voice.revision, id, text, consent: true })).rejects.toBeInstanceOf(VoiceConflict);
  });
  it("enforces storage bounds even through raw SQL and rejects missing approval time", async () => {
    await repository.mutate(a, { action: "enable", revision: 0, enabled: false, consent: true });
    const query = "INSERT INTO editorial_voice_samples (id, tenant_id, user_id, slot, text, origin, approved_at) VALUES ($1, $2, $3, $4, $5, $6, $7)";
    for (const [slot, value, origin, approved] of [[6, text, "explicit-sample", new Date()], [1, "x".repeat(1001), "explicit-sample", new Date()], [1, "short", "explicit-sample", new Date()], [1, text, "private-history", new Date()], [1, text, "explicit-sample", null]]) {
      await expect(raw(a, query, [randomUUID(), a.tenantId, a.userId, slot, value, origin, approved])).rejects.toThrow();
    }
    expect((await repository.get(a)).samples).toEqual([]);
  });
  it("has ENABLE and FORCE policies on both new tables", async () => {
    const result = await ownerPool.query("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1::text[])", [["editorial_voices", "editorial_voice_samples"]]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every(row => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });
});