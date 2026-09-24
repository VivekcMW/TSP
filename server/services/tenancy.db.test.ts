import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { requireLocalTestDatabase } from "../../test/database-safety";
import { pool } from "../db";
import { ownerDb, ownerPool } from "../../test/db-owner";
import { tenantMembers, tenants, users } from "@shared/schema";
import { ensurePersonalTenant } from "./tenancy";

const userIds: string[] = [];
const personalTenants = (userId: string) => ownerDb.select({ id: tenants.id }).from(tenantMembers)
  .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
  .where(and(eq(tenantMembers.userId, userId), eq(tenants.kind, "personal")));

beforeAll(async () => {
  const target = requireLocalTestDatabase();
  expect((await pool.query("select current_user, current_database()")).rows[0]).toEqual({ current_user: "tsp_app", current_database: target.database });
});
afterEach(async () => {
  if (userIds.length) {
    const owned = await ownerDb.select({ id: tenantMembers.tenantId }).from(tenantMembers).where(inArray(tenantMembers.userId, userIds));
    if (owned.length) await ownerDb.delete(tenants).where(inArray(tenants.id, owned.map(row => row.id)));
    await ownerDb.delete(users).where(inArray(users.id, userIds));
  }
  userIds.length = 0;
});
afterAll(async () => { await pool.end(); await ownerPool.end(); });

async function newUser() {
  const id = randomUUID();
  await ownerDb.insert(users).values({ id, email: `${id}@tenancy.test` });
  userIds.push(id);
  return id;
}

describe("personal workspace creation", () => {
  it("creates exactly one personal workspace when first requests race", async () => {
    const userId = await newUser();
    const ids = await Promise.all(Array.from({ length: 8 }, () => ensurePersonalTenant(userId)));
    expect(new Set(ids).size).toBe(1);
    expect(await personalTenants(userId)).toEqual([{ id: ids[0] }]);
    expect(await ensurePersonalTenant(userId)).toBe(ids[0]);
  });
});

describe("0041 removes empty duplicate personal workspaces", () => {
  it("keeps each user's workspace with data and never deletes one that holds data", async () => {
    const migration = readFileSync(new URL("../../migrations/0041_remove_empty_duplicate_personal_workspaces.sql", import.meta.url), "utf8");
    const connection = await ownerPool.connect();
    try {
      await connection.query("BEGIN");
      const user = async () => { const id = randomUUID(); await connection.query("insert into users (id, email) values ($1, $2)", [id, `${id}@tenancy.test`]); return id; };
      const workspace = async (userId: string, createdAt: string) => {
        const { rows: [row] } = await connection.query("insert into tenants (kind, name, status, created_at) values ('personal', 'Personal workspace', 'active', $1) returning id", [createdAt]);
        await connection.query("insert into tenant_members (tenant_id, user_id, role) values ($1, $2, 'owner')", [row.id, userId]);
        return row.id as string;
      };
      const story = (tenantId: string, userId: string) => connection.query(
        "insert into inbox_items (tenant_id, user_id, headline, source, article_url, status) values ($1, $2, 'A story', 'Fixture', $3, 'active')", [tenantId, userId, `https://news.test/${randomUUID()}`]);
      const profile = (tenantId: string, userId: string, keywords = "[]") => connection.query(
        "insert into user_profiles (tenant_id, user_id, onboarding_status, keywords) values ($1, $2, 'pending', $3::jsonb)", [tenantId, userId, keywords]);
      const remaining = async (userId: string) => (await connection.query(
        "select t.id from tenants t join tenant_members m on m.tenant_id = t.id where m.user_id = $1 and t.kind = 'personal' order by t.created_at", [userId])).rows.map(row => row.id);

      // The race's shape: data in one workspace, an untouched pending profile in the other.
      const raced = await user(); const kept = await workspace(raced, "2026-09-22T04:34:00.265Z"); const empty = await workspace(raced, "2026-09-22T04:34:00.260Z");
      await story(kept, raced); await profile(empty, raced);
      // Both hold data: left for manual review.
      const both = await user(); const b1 = await workspace(both, "2026-09-01T00:00:00Z"); const b2 = await workspace(both, "2026-09-01T00:00:01Z");
      await story(b1, both); await story(b2, both);
      // A pending profile with chosen topics is data.
      const touched = await user(); const t1 = await workspace(touched, "2026-09-01T00:00:00Z"); const t2 = await workspace(touched, "2026-09-01T00:00:01Z");
      await story(t1, touched); await profile(t2, touched, '[{"keyword":"CTV","weight":0.8}]');
      // Neither holds data: keep the oldest.
      const idle = await user(); const i1 = await workspace(idle, "2026-09-01T00:00:00Z"); await workspace(idle, "2026-09-01T00:00:01Z");
      // A single workspace is never touched, even when empty.
      const single = await user(); const only = await workspace(single, "2026-09-01T00:00:00Z");

      await connection.query(migration);
      await connection.query(migration);

      expect(await remaining(raced)).toEqual([kept]);
      expect(await remaining(both)).toEqual([b1, b2]);
      expect(await remaining(touched)).toEqual([t1, t2]);
      expect(await remaining(idle)).toEqual([i1]);
      expect(await remaining(single)).toEqual([only]);
      expect((await connection.query("select count(*)::int as n from inbox_items where tenant_id = $1", [kept])).rows[0].n).toBe(1);
    } finally {
      await connection.query("ROLLBACK");
      connection.release();
    }
  });
});
