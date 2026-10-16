import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireLocalTestDatabase } from "../../test/database-safety";
import { ownerPool } from "../../test/db-owner";
import { pool } from "../db";
import { creationSession, CreationConflict } from "./creationSession";
import type { CreationSession } from "@shared/creation-session";

const prefix = `creation-${randomUUID()}`;
const owner = { tenantId: `${prefix}-tenant`, userId: `${prefix}-user` };
const peer = { tenantId: owner.tenantId, userId: `${prefix}-peer` };
const foreign = { tenantId: `${prefix}-foreign`, userId: owner.userId };
const state: CreationSession = { version: 1, step: "source", source: { mode: "manual", url: "",
  manual: { title: "My idea", content: "This is a private main draft idea.", media: [] } },
tone: "thoughtLeader", format: "short-post", selectedPlatforms: [], versions: [] };
beforeAll(async () => {
  requireLocalTestDatabase();
  await ownerPool.query("INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)",
    [owner.userId, `${owner.userId}@example.invalid`, peer.userId, `${peer.userId}@example.invalid`]);
  await ownerPool.query("INSERT INTO tenants (id, kind, name) VALUES ($1, 'personal', 'Creation fixture'), ($2, 'personal', 'Foreign creation')",
    [owner.tenantId, foreign.tenantId]);
});
afterAll(async () => {
  try {
    await ownerPool.query("DELETE FROM tenants WHERE id = ANY($1::varchar[])", [[owner.tenantId, foreign.tenantId]]);
    await ownerPool.query("DELETE FROM users WHERE id = ANY($1::varchar[])", [[owner.userId, peer.userId]]);
  } finally { await pool.end(); await ownerPool.end(); }
});
describe("durable creation sessions", () => {
  it("saves and reads progress without creating a publication draft", async () => {
    expect(await creationSession(owner)).toEqual({ revision: 0, state: null });
    expect(await creationSession(owner, { revision: 0, state })).toEqual({ revision: 1, state });
    expect(await creationSession(owner)).toEqual({ revision: 1, state });
    const tenantContext = { ...owner, role: "owner", kind: "personal", permissions: ["draft:write:own"] };
    expect(await creationSession(tenantContext)).toEqual({ revision: 1, state });
    expect((await ownerPool.query("SELECT id FROM drafts WHERE tenant_id=$1", [owner.tenantId])).rows).toEqual([]);
  });
  it("accepts an exact replay after a lost acknowledgement but refuses a stale overwrite", async () => {
    expect((await creationSession(owner, { revision: 0, state })).revision).toBe(1);
    await expect(creationSession(owner, { revision: 0, state: { ...state, step: "review" } })).rejects.toBeInstanceOf(CreationConflict);
    expect((await creationSession(owner)).state).toEqual(state);
  });
  it("isolates other users and tenants", async () => {
    expect(await creationSession(peer)).toEqual({ revision: 0, state: null });
    expect(await creationSession(foreign)).toEqual({ revision: 0, state: null });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)", [peer.tenantId, peer.userId]);
      expect((await client.query("SELECT * FROM creation_sessions")).rows).toEqual([]);
      expect((await client.query("UPDATE creation_sessions SET revision=revision+1")).rowCount).toBe(0);
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
  it("serializes conflicting concurrent edits", async () => {
    const outcomes = await Promise.allSettled([
      creationSession(owner, { revision: 1, state: { ...state, format: "article" } }),
      creationSession(owner, { revision: 1, state: { ...state, selectedPlatforms: ["linkedin"] } }),
    ]);
    expect(outcomes.filter(value => value.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(value => value.status === "rejected")).toHaveLength(1);
  });
  it("rejects malformed, oversized and identity-injecting writes", async () => {
    for (const input of [
      { revision: -1, state }, { revision: 2, state, tenantId: foreign.tenantId },
      { revision: 2, state: { ...state, selectedPlatforms: ["main-draft"] } },
      { revision: 2, state: { ...state, source: { ...state.source, manual: { ...state.source.manual, content: "x".repeat(20_001) } } } },
    ]) await expect(creationSession(owner, input)).rejects.toThrow();
  });
  it("persists rich formatting and rejects text that disagrees without losing saved work", async () => {
    const formatJson = JSON.stringify({ type: "doc", content: [{ type: "paragraph", attrs: { textAlign: "center" },
      content: [{ type: "text", text: "Styled document", marks: [{ type: "bold" }, { type: "underline" }] }] }] });
    const formatted: CreationSession = { ...state, main: { title: "Saved", content: "Styled document", original: "", revision: 1, formatJson } };
    await creationSession(peer, { revision: 0, state: formatted });
    expect(await creationSession(peer)).toEqual({ revision: 1, state: formatted });
    await expect(creationSession(peer, { revision: 1, state: { ...formatted, main: { ...formatted.main!, content: "Mismatched" } } })).rejects.toThrow();
    expect(await creationSession(peer)).toEqual({ revision: 1, state: formatted });
  });
});
