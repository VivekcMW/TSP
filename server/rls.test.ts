import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "./db";
import { users } from "@shared/models/auth";
import { tenantMembers, tenants } from "@shared/models/tenancy";
import { drafts, inboxItems, socialAccounts, socialAnalytics, userProfiles } from "@shared/schema";
import { ownerDb, ownerPool } from "../test/db-owner";

/**
 * Row-Level Security: the second isolation layer.
 *
 * The repository tests prove the application adds a tenant predicate to every
 * query. These prove the database refuses to return other tenants' rows *even
 * when the query has no predicate at all* — which is the only thing that helps
 * when a future query forgets one.
 *
 * This layer is inert unless the app connects as a non-superuser, non-owner
 * role: superusers bypass RLS unconditionally, and FORCE ROW LEVEL SECURITY
 * does not change that. The app connects as tsp_app for exactly this reason.
 */

const TENANT_A = "rls-tenant-a";
const TENANT_B = "rls-tenant-b";

/** Runs a query with app.tenant_id set transaction-locally, as the app does. */
async function inTenantContext<T>(tenantId: string, run: (tx: never) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return run(tx as never);
  });
}

beforeEach(async () => {
  await ownerDb.delete(socialAnalytics);
  await ownerDb.delete(socialAccounts);
  await ownerDb.delete(drafts);
  await ownerDb.delete(inboxItems);
  await ownerDb.delete(userProfiles);
  await ownerDb.delete(tenantMembers);
  await ownerDb.delete(tenants);
  await ownerDb.delete(users);

  await ownerDb.insert(users).values([
    { id: "rls-u-a", email: "a@rls.test" },
    { id: "rls-u-b", email: "b@rls.test" },
  ]);
  await ownerDb.insert(tenants).values([
    { id: TENANT_A, kind: "personal", name: "A" },
    { id: TENANT_B, kind: "personal", name: "B" },
  ]);
  await ownerDb.insert(drafts).values([
    { tenantId: TENANT_A, userId: "rls-u-a", platform: "linkedin", tone: "professional", content: "A draft" },
    { tenantId: TENANT_B, userId: "rls-u-b", platform: "linkedin", tone: "professional", content: "B draft" },
  ]);
});

afterAll(async () => {
  await pool.end();
  await ownerPool.end();
});

describe("the database enforces isolation without help from the query", () => {
  it("returns only the in-context tenant's rows for a predicate-free select", async () => {
    const inA = await inTenantContext(TENANT_A, async (tx) =>
      // Deliberately no WHERE clause. This is the query a future bug writes.
      (tx as unknown as typeof db).execute(sql`select content from drafts`),
    );
    const inB = await inTenantContext(TENANT_B, async (tx) =>
      (tx as unknown as typeof db).execute(sql`select content from drafts`),
    );

    expect(inA.rows.map((r) => r.content)).toEqual(["A draft"]);
    expect(inB.rows.map((r) => r.content)).toEqual(["B draft"]);
  });

  it("returns nothing when no tenant context is set", async () => {
    // Fails closed. A request that somehow reaches the database without a
    // tenant sees an empty result, not everything.
    const result = await db.execute(sql`select content from drafts`);
    expect(result.rows).toHaveLength(0);
  });

  it("refuses to insert a row belonging to another tenant", async () => {
    // The WITH CHECK half of the policy: being in tenant A's context does not
    // allow writing a row stamped with tenant B.
    await expect(
      inTenantContext(TENANT_A, async (tx) =>
        (tx as unknown as typeof db).execute(sql`
          insert into drafts (tenant_id, user_id, platform, tone, content)
          values (${TENANT_B}, 'rls-u-b', 'linkedin', 'professional', 'forged')
        `),
      ),
    ).rejects.toThrow(/row-level security/i);

    // And nothing was written.
    const all = await ownerDb.select().from(drafts);
    expect(all.map((d) => d.content).sort()).toEqual(["A draft", "B draft"]);
  });

  it("cannot update or delete another tenant's row without a predicate", async () => {
    await inTenantContext(TENANT_A, async (tx) => {
      await (tx as unknown as typeof db).execute(sql`update drafts set content = 'overwritten'`);
      await (tx as unknown as typeof db).execute(sql`delete from drafts`);
    });

    // Read as the owner, bypassing RLS, so this distinguishes "invisible to A"
    // from "actually gone".
    const remaining = await ownerDb.select().from(drafts);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].content).toBe("B draft");
    expect(remaining[0].tenantId).toBe(TENANT_B);
  });

  it("covers every tenant-scoped table", async () => {
    const expected = [
      "drafts",
      "engine_run_logs",
      "inbox_items",
      "social_accounts",
      "social_analytics",
      "user_profiles",
    ];
    const result = await ownerDb.execute(sql`
      select c.relname::text as name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relrowsecurity
        and c.relforcerowsecurity
        and exists (select 1 from pg_policies p
                    where p.tablename = c.relname and p.policyname = 'tenant_isolation')
      order by 1
    `);
    expect(result.rows.map((r) => r.name)).toEqual(expected);
  });

  it("leaves the tenancy tables readable, or nobody could sign in", async () => {
    // Resolving "which tenants may this user act in?" happens before a tenant
    // is known, so tenants and tenant_members must not be tenant-scoped.
    const t = await db.execute(sql`select count(*)::int as n from tenants`);
    const m = await db.execute(sql`select count(*)::int as n from tenant_members`);
    expect(t.rows[0].n).toBe(2);
    expect(m.rows[0].n).toBe(0);
  });
});
