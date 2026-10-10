/** Opt-in PostgreSQL acceptance. NEVER run against the shared application test DB.
 * Provisioning and cleanup are operator responsibilities. This file creates no
 * databases/roles/clusters and leaves successful chain commits for inspection.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Client } from "pg";
import { acceptanceConnectionOptions } from "./migration-acceptance-guard";
import { preflightMigrations, readMigrationSources, runMigrations, type MigrationConnection, type MigrationSource } from "./migration-runner";

async function catalog(client: Client) {
  return (await client.query(`SELECT 'relation' AS kind, c.relname AS name FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    UNION ALL SELECT 'function', p.proname FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
    UNION ALL SELECT 'type', t.typname FROM pg_type t
    JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'
    ORDER BY kind, name`)).rows;
}

async function atomicityChecks(client: Client) {
  // No successful probe commit: schema, data AND ledger must all roll back.
  const probe: MigrationSource = {
    filename: "0098_atomic_probe.sql",
    body: "BEGIN; CREATE TABLE public.migration_atomic_probe (id int); INSERT INTO public.migration_atomic_probe VALUES (1); COMMIT;",
  };
  for (const failure of ["body", "ledger"] as const) {
    const sources = failure === "body"
      ? [{ ...probe, body: probe.body.replace("COMMIT;", "SELECT 1/0; COMMIT;") }]
      : [probe];
    const injected: MigrationConnection = {
      query: async (text, values) => {
        if (failure === "ledger" && text.startsWith("INSERT INTO public.schema_migrations")) {
          return client.query("SELECT 1/0");
        }
        return client.query(text, values);
      },
    };
    await assert.rejects(runMigrations(injected, sources), { code: "22012" });
    assert.equal((await client.query("SELECT to_regclass('public.migration_atomic_probe') AS probe, to_regclass('public.schema_migrations') AS ledger")).rows[0].probe, null);
    assert.equal((await client.query("SELECT to_regclass('public.schema_migrations') AS ledger")).rows[0].ledger, null);
  }
}

async function inScratch(client: Client, work: () => Promise<void>) {
  const schema = `migration_probe_${randomUUID().replaceAll("-", "")}`;
  await client.query("BEGIN");
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path = "${schema}", pg_catalog`);
    await client.query("CREATE TABLE user_profiles (id text PRIMARY KEY, keywords jsonb); CREATE TABLE inbox_items (user_id text)");
    await work();
  } finally { await client.query("ROLLBACK"); }
  assert.equal((await client.query("SELECT count(*)::int AS count FROM pg_namespace WHERE nspname=$1", [schema])).rows[0].count, 0);
}

async function keywordChecks(client: Client, sources: MigrationSource[]) {
  const inventory = preflightMigrations(sources);
  const old = inventory.find(m => m.filename.startsWith("0022_"));
  const repair = inventory.find(m => m.filename.startsWith("0038_"));
  assert.ok(old && repair, "Requires historical 0022 and forward repair 0038");
  const zero = { keyword: "Cloud", weight: 0, category: "Infrastructure", metadata: { retained: true } };
  const positive = { keyword: "AI", weight: 1, category: "AI" };
  const missingWeight = { keyword: "Optional weight", category: "Topic" };
  const cases = [
    { id: "empty", input: [], expected: [] },
    { id: "strings", input: ["COMMIT", "same", "same"], expected: [{ keyword: "COMMIT", weight: 0.7 }, { keyword: "same", weight: 0.7 }, { keyword: "same", weight: 0.7 }] },
    { id: "weighted", input: [zero, positive, missingWeight], expected: [zero, positive, missingWeight] },
    { id: "mixed", input: [zero, "legacy", positive, missingWeight, zero], expected: [zero, { keyword: "legacy", weight: 0.7 }, positive, missingWeight, zero] },
  ];
  await inScratch(client, async () => {
    for (const item of cases) await client.query("INSERT INTO user_profiles VALUES ($1, $2::jsonb)", [item.id, JSON.stringify(item.input)]);
    await client.query("INSERT INTO user_profiles VALUES ('sql-null', NULL)");
    await client.query(old.sql);
    const wrapped = (await client.query("SELECT keywords FROM user_profiles WHERE id='mixed'")).rows[0].keywords;
    assert.deepEqual(wrapped[0], { keyword: zero, weight: 0.7 }, "Reproduce actual 0022 wrapping, not a JS simulation");
    await client.query(repair.sql);
    for (const item of cases) assert.deepEqual((await client.query("SELECT keywords FROM user_profiles WHERE id=$1", [item.id])).rows[0].keywords, item.expected);
    assert.equal((await client.query("SELECT keywords FROM user_profiles WHERE id='sql-null'")).rows[0].keywords, null);
    const before = (await client.query("SELECT id, keywords, ctid::text FROM user_profiles ORDER BY id")).rows;
    await client.query(repair.sql);
    assert.deepEqual((await client.query("SELECT id, keywords, ctid::text FROM user_profiles ORDER BY id")).rows, before, "Idempotent repair performs no second updates");
  });
  const invalid = [
    null, {}, "not an array", [null], [false], [42], [[]],
    [{ keyword: zero, weight: 0.8 }], [{ keyword: zero, weight: 0.7, category: "ambiguous outer" }],
    [{ keyword: { keyword: zero, weight: 0.7 }, weight: 0.7 }],
    [{ keyword: zero, weight: "0.7" }], [{ keyword: "weight", weight: "0" }],
    [{ keyword: "weight", weight: -1 }], [{ keyword: "weight", weight: 2 }],
    [{ keyword: "category", category: null }], [{ keyword: "" }],
  ];
  for (const value of invalid) {
    await inScratch(client, async () => {
      // First row can be repaired; later failure must undo even that earlier update.
      await client.query("INSERT INTO user_profiles VALUES ('a-recoverable', $1::jsonb), ('z-invalid', $2::jsonb)", [JSON.stringify([{ keyword: zero, weight: 0.7 }]), JSON.stringify(value)]);
      const before = (await client.query("SELECT id, keywords FROM user_profiles ORDER BY id")).rows;
      await client.query("SAVEPOINT before_repair");
      await assert.rejects(client.query(repair.sql), /0038:/);
      await client.query("ROLLBACK TO SAVEPOINT before_repair");
      assert.deepEqual((await client.query("SELECT id, keywords FROM user_profiles ORDER BY id")).rows, before);
    });
  }
}

export async function runMigrationAcceptance(env: Record<string, string | undefined>) {
  const config = acceptanceConnectionOptions(env); // BEFORE pg import/connection.
  const sources = readMigrationSources(resolve(import.meta.dirname, "../migrations"));
  const inventory = preflightMigrations(sources);
  const { default: pg } = await import("pg");
  const client = new pg.Client(config);
  try {
    await client.connect();
    const identity = (await client.query(`SELECT current_database() AS db, current_user AS username,
      host(inet_server_addr()) AS address, inet_server_port() AS port,
      r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls,
      d.datdba=r.oid AS owns_database
      FROM pg_roles r JOIN pg_database d ON d.datname=current_database() WHERE r.rolname=current_user`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.username, config.user);
    assert.equal(identity.port, config.port);
    assert.ok(["127.0.0.1", "::1"].includes(identity.address), "Acceptance server must use a literal loopback address");
    assert.equal(identity.rolsuper, false, "Do not run acceptance as a cluster administrator");
    assert.equal(identity.rolcreaterole, false, "Harness may not create roles");
    assert.equal(identity.rolcreatedb, false, "Harness may not create databases");
    assert.equal(identity.rolbypassrls, true, "Historical cross-tenant backfills require operator-provisioned BYPASSRLS owner");
    assert.equal(identity.owns_database, true);
    const appRole = (await client.query("SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname='tsp_app'")).rows[0];
    assert.deepEqual(appRole, { rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false }, "Pre-provision restricted tsp_app; do not let 0002 create it");
    assert.deepEqual(await catalog(client), [], "Disposable public schema must be completely empty");
    const schemas = (await client.query("SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('public','information_schema')")).rows;
    assert.deepEqual(schemas, [], "No existing application/scratch schemas permitted");
    const before = await catalog(client);
    const dry = await runMigrations(client, sources, { dryRun: true });
    assert.equal(dry.pending.length, inventory.length);
    assert.deepEqual(await catalog(client), before, "Dry-run must not create ledger/catalog objects");
    await atomicityChecks(client);
    assert.deepEqual(await catalog(client), before, "Failure probes leave empty database intact");
    const applied = await runMigrations(client, sources);
    assert.equal(applied.appliedCount, inventory.length);
    const ledger = (await client.query("SELECT filename, checksum FROM public.schema_migrations ORDER BY filename")).rows;
    assert.deepEqual(ledger, inventory.map(m => ({ filename: m.filename, checksum: m.checksum })));
    assert.equal((await runMigrations(client, sources)).appliedCount, 0);
    const tampered = sources.map((m, index) => index === 0 ? { ...m, body: m.body + "\n-- deliberate drift probe\n" } : m);
    await assert.rejects(runMigrations(client, tampered), /checksum changed/);
    assert.deepEqual((await client.query("SELECT filename, checksum FROM public.schema_migrations ORDER BY filename")).rows, ledger);
    await keywordChecks(client, sources);
    return { files: inventory.length, freshChain: "passed", dryRun: "passed", atomicity: "passed", keywordRepair: "passed", cleanup: "operator-owned disposable database retained" };
  } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assert.equal(process.argv.length, 2, "No CLI arguments accepted; use the explicit acceptance environment gates");
    console.log(JSON.stringify(await runMigrationAcceptance(process.env)));
  } catch {
    console.error("Migration acceptance failed or prerequisites absent. No acceptance claim. Retain disposable database for controlled inspection; no automatic cleanup/provisioning.");
    process.exitCode = 1;
  }
}