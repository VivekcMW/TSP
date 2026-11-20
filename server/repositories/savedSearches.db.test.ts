import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { requireLocalTestDatabase } from "../../test/database-safety";
import type { TenantScope } from "../storage";

// Opt-in AFTER migration 0060 is applied to the explicit local test database. Unique fixtures only;
// never migrates or touches development data. Imports open no pool when skipped.
const enabled = process.env.NEWS_SEARCH_DB_TESTS === "true";

describe.skipIf(!enabled)("saved searches repository on PostgreSQL with RLS (0060 prerequisite)", () => {
  let app: typeof import("../db");
  let owner: typeof import("../../test/db-owner");
  let repo: typeof import("./savedSearches");
  const prefix = `saved-search-${randomUUID()}`;
  const scope: TenantScope = { tenantId: `${prefix}-a`, userId: `${prefix}-u1` };
  const teammate: TenantScope = { tenantId: scope.tenantId, userId: `${prefix}-u2` };
  const otherTenant: TenantScope = { tenantId: `${prefix}-b`, userId: scope.userId };

  async function asApp<T>(target: TenantScope | null, query: string, values: unknown[] = []) {
    const client = await app.pool.connect();
    try {
      await client.query("BEGIN");
      if (target) await client.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [target.tenantId, target.userId]);
      return (await client.query(query, values)).rows as T[];
    } finally { await client.query("ROLLBACK"); client.release(); }
  }

  beforeAll(async () => {
    const target = requireLocalTestDatabase();
    app = await import("../db");
    owner = await import("../../test/db-owner");
    repo = await import("./savedSearches");
    expect((await app.pool.query("select current_user, current_database(), rolbypassrls, rolsuper from pg_roles where rolname = current_user")).rows[0])
      .toEqual({ current_user: "tsp_app", current_database: target.database, rolbypassrls: false, rolsuper: false });
    expect((await app.pool.query("select to_regclass('public.saved_searches') is not null as ready")).rows[0]).toEqual({ ready: true });
    await owner.ownerPool.query("INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)", [scope.userId, `${scope.userId}@example.invalid`, teammate.userId, `${teammate.userId}@example.invalid`]);
    await owner.ownerPool.query("INSERT INTO tenants (id, kind, name) VALUES ($1, 'personal', 'Saved search A'), ($2, 'personal', 'Saved search B')", [scope.tenantId, otherTenant.tenantId]);
  });
  afterEach(async () => {
    await owner.ownerPool.query("DELETE FROM saved_searches WHERE tenant_id = ANY($1::varchar[])", [[scope.tenantId, otherTenant.tenantId]]);
    await owner.ownerPool.query("DELETE FROM inbox_items WHERE tenant_id = ANY($1::varchar[])", [[scope.tenantId, otherTenant.tenantId]]);
  });
  afterAll(async () => {
    try {
      await owner?.ownerPool.query("DELETE FROM tenants WHERE id = ANY($1::varchar[])", [[scope.tenantId, otherTenant.tenantId]]);
      await owner?.ownerPool.query("DELETE FROM users WHERE id = ANY($1::varchar[])", [[scope.userId, teammate.userId]]);
    } finally { await app?.pool.end(); await owner?.ownerPool.end(); }
  });

  it("creates, dedupes by lower(query), lists, renames, marks viewed and deletes", async () => {
    const first = await repo.createSavedSearch(scope, { query: "AI source:FT", name: "AI" });
    expect(first).toMatchObject({ created: true, search: { tenantId: scope.tenantId, userId: scope.userId, query: "AI source:FT", name: "AI", lastViewedAt: null } });
    const again = await repo.createSavedSearch(scope, { query: "ai SOURCE:ft", name: "Other" });
    expect(again).toEqual({ created: false, search: first.search });
    await repo.createSavedSearch(scope, { query: "chips", name: "beta" });
    expect((await repo.listSavedSearches(scope)).map(search => search.name)).toEqual(["AI", "beta"]);

    expect((await repo.renameSavedSearch(scope, first.search.id, "Alpha"))?.name).toBe("Alpha");
    expect((await repo.markSavedSearchViewed(scope, first.search.id))?.lastViewedAt).toBeInstanceOf(Date);
    expect(await repo.deleteSavedSearch(scope, first.search.id)).toBe(true);
    expect(await repo.deleteSavedSearch(scope, first.search.id)).toBe(false);
    expect((await repo.listSavedSearches(scope)).map(search => search.query)).toEqual(["chips"]);
  });

  it("keeps each member's searches private, inside and across tenants", async () => {
    const mine = (await repo.createSavedSearch(scope, { query: "ai", name: "ai" })).search;
    await repo.createSavedSearch(teammate, { query: "ai", name: "Teammate" });
    await repo.createSavedSearch(otherTenant, { query: "ai", name: "Other tenant" });
    expect((await repo.listSavedSearches(teammate)).map(search => search.name)).toEqual(["Teammate"]);
    expect((await repo.listSavedSearches(otherTenant)).map(search => search.name)).toEqual(["Other tenant"]);
    expect(await repo.renameSavedSearch(teammate, mine.id, "Taken")).toBeUndefined();
    expect(await repo.markSavedSearchViewed(otherTenant, mine.id)).toBeUndefined();
    expect(await repo.deleteSavedSearch(teammate, mine.id)).toBe(false);
    expect((await owner.ownerPool.query("SELECT name FROM saved_searches WHERE id = $1", [mine.id])).rows).toEqual([{ name: "ai" }]);
  });

  it("enforces forced RLS for the app role even without a predicate", async () => {
    await repo.createSavedSearch(scope, { query: "ai", name: "ai" });
    await repo.createSavedSearch(otherTenant, { query: "chips", name: "chips" });
    expect(await asApp(null, "SELECT id FROM saved_searches WHERE tenant_id = ANY($1::varchar[])", [[scope.tenantId, otherTenant.tenantId]])).toEqual([]);
    expect((await asApp<{ query: string }>(otherTenant, "SELECT query FROM saved_searches WHERE tenant_id = ANY($1::varchar[])", [[scope.tenantId, otherTenant.tenantId]])).map(row => row.query)).toEqual(["chips"]);
    await expect(asApp(otherTenant, "INSERT INTO saved_searches (tenant_id, user_id, name, query) VALUES ($1, $2, 'x', 'x')", [scope.tenantId, scope.userId])).rejects.toThrow(/row-level security/);
  });

  it("caps each member at 25 followed searches and checks lengths in the database", async () => {
    for (let i = 0; i < repo.SAVED_SEARCH_LIMIT; i++) await repo.createSavedSearch(scope, { query: `topic ${i}`, name: `Topic ${i}` });
    await expect(repo.createSavedSearch(scope, { query: "one more", name: "One more" })).rejects.toBeInstanceOf(repo.SavedSearchLimitError);
    expect((await repo.createSavedSearch(scope, { query: "TOPIC 3", name: "Again" })).created).toBe(false);
    expect((await repo.createSavedSearch(teammate, { query: "one more", name: "One more" })).created).toBe(true);
    await expect(repo.createSavedSearch(otherTenant, { query: "x", name: "x".repeat(61) })).rejects.toThrow();
    await expect(repo.createSavedSearch(otherTenant, { query: " ", name: "x" })).rejects.toThrow();
  });

  it("finds only the caller's own inbox rows by exact canonical URL", async () => {
    const insert = (target: TenantScope, url: string, status: string) => owner.ownerPool.query(
      "INSERT INTO inbox_items (tenant_id, user_id, headline, source, article_url, canonical_url, status) VALUES ($1, $2, 'h', 's', $3, $3, $4) RETURNING id",
      [target.tenantId, target.userId, url, status]).then(result => result.rows[0].id as string);
    const mine = await insert(scope, `https://news.test/${prefix}/a`, "saved");
    await insert(teammate, `https://news.test/${prefix}/b`, "active");
    await insert(otherTenant, `https://news.test/${prefix}/a`, "active");
    expect(await repo.findInboxItemsByCanonicalUrls(scope, [`https://news.test/${prefix}/a`, `https://news.test/${prefix}/b`, `https://news.test/${prefix}/A`]))
      .toEqual([{ id: mine, status: "saved", canonicalUrl: `https://news.test/${prefix}/a` }]);
    expect(await repo.findInboxItemsByCanonicalUrls(scope, [])).toEqual([]);
  });
});
