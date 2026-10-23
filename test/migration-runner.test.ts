import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { normalizeMigrationSql, splitSqlStatements } from "../script/migration-sql";
import { migrationChecksum, migrationConnectionOptions, parseMigrationArgs, planMigrations, preflightMigrations, readMigrationSources, runMigrations, type MigrationSource } from "../script/migration-runner";
import { acceptanceConnectionOptions } from "../script/migration-acceptance-guard";
import { runMigrationAcceptance } from "../script/migration-acceptance";

const source = (body = "BEGIN; CREATE TABLE example (id int); COMMIT;", filename = "0000_example.sql"): MigrationSource => ({ filename, body });
function connection(applied: MigrationSource[] = [], fail?: (sql: string) => boolean) {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    if (fail?.(sql)) throw new Error("injected failure");
    if (sql.includes("to_regclass")) return { rows: [{ ledger: applied.length ? "schema_migrations" : null }] };
    if (sql.startsWith("SELECT filename")) return { rows: applied.map(m => ({ filename: m.filename, checksum: migrationChecksum(m.body) })) };
    return { rows: [] };
  });
  return { query };
}

describe("SQL lexical boundaries", () => {
  it.each(["BEGIN", "BEGIN WORK", "BEGIN TRANSACTION", "START TRANSACTION"])("normalizes plain outer %s only", begin => {
    const body = "\nSELECT 'COMMIT; BEGIN; SAVEPOINT x;';\n";
    const result = normalizeMigrationSql(`${begin};${body}COMMIT;`);
    expect(result.sql).toContain(body);
    expect(result.removedControls).toBe(2);
    expect(result.statementCount).toBe(1);
  });
  it.each(["COMMIT WORK", "COMMIT TRANSACTION", "END", "END WORK", "END TRANSACTION"])("supports exact closing %s", end => {
    expect(normalizeMigrationSql(`BEGIN; SELECT 1; ${end};`).removedControls).toBe(2);
  });
  it("preserves opaque DO/function bodies, nested tags, strings, quotes and comments byte-for-byte", () => {
    const body = String.raw`
-- COMMIT; with CRLF
/* outer /* BEGIN; */ COMMIT; */
DO $body$ BEGIN EXECUTE $inner$SELECT 'COMMIT;'$inner$; END $body$;
CREATE FUNCTION test() RETURNS text AS $$ BEGIN RETURN 'BEGIN;'; END; $$ LANGUAGE plpgsql;
SELECT E'quote\'; COMMIT; -- inside', 'it''s COMMIT;', "COMMIT;";
SELECT 'literal\', U&'d\0061ta', $tag$END; SAVEPOINT x;$tag$, café$identifier;
`;
    const result = normalizeMigrationSql(`-- lead\nBEGIN /* retained */;${body}COMMIT; -- tail`);
    expect(result.sql).toContain(body);
    expect(result.sql).toContain("/* retained */");
    expect(result.sql).toContain("-- tail");
    expect(result.statementCount).toBe(4);
    expect(normalizeMigrationSql(result.sql).sql).toBe(result.sql);
  });
  it("handles CR-only comments and trailing comments/empty statements", () => {
    expect(normalizeMigrationSql("-- comment\rBEGIN; ;; SELECT 1; COMMIT; -- end").statementCount).toBe(1);
    expect(splitSqlStatements("; -- nothing\n /* nested /* comment */ */")).toEqual([]);
  });
  it("preserves escape-string continuation across newlines and comments", () => {
    const body = String.raw`SELECT E'first'
      -- continuation
      '\'; COMMIT; still inside';`;
    const result = normalizeMigrationSql(`BEGIN; ${body} COMMIT;`);
    expect(result.sql).toContain(body);
    expect(result.statementCount).toBe(1);
    expect(result.removedControls).toBe(2);
  });
  it.each([
    "COMMIT;", "SELECT 1; COMMIT;", "BEGIN; SELECT 1;", "BEGIN; COMMIT; SELECT 1;",
    "BEGIN; SELECT 1; COMMIT; COMMIT;", "BEGIN; BEGIN; SELECT 1; COMMIT; COMMIT;",
    "BEGIN; SAVEPOINT x; COMMIT;", "RELEASE SAVEPOINT x;", "ROLLBACK;", "ABORT;",
    "ROLLBACK TO x;", "PREPARE TRANSACTION 'x';", "COMMIT PREPARED 'x';",
    "BEGIN; SELECT 1; COMMIT AND CHAIN;", "BEGIN ISOLATION LEVEL SERIALIZABLE; SELECT 1; COMMIT;",
    "SET TRANSACTION READ ONLY;", "SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE;",
    "SELECT 1; -- harmless\rCOMMIT;",
  ])("rejects unexpected transaction control: %s", sql => {
    expect(() => normalizeMigrationSql(sql)).toThrow(/transaction control/);
  });
  it.each(["SELECT 'oops", 'SELECT "oops', "DO $tag$BEGIN; END;", "/* unclosed /* nested */", String.raw`SELECT E'escaped\'`])("rejects unterminated SQL: %s", sql => {
    expect(() => normalizeMigrationSql(sql)).toThrow(/Unterminated/);
  });
  it.each(["COPY foo FROM STDIN;", "CALL foo();", "\\i other.sql", "SET standard_conforming_strings = off;", "RESET ALL;", 'SET "standard_conforming_strings" = off;', "CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT 1; END;"])("fails closed on unsupported lexical forms: %s", sql => {
    expect(() => normalizeMigrationSql(sql)).toThrow(/Unsupported|transaction control/);
  });
});

describe("runner over a mocked dedicated connection (not PostgreSQL acceptance)", () => {
  it("preflights every file before ANY query, even with --only", async () => {
    const client = connection();
    await expect(runMigrations(client, [source(), source("COMMIT;", "0001_bad.sql")], { onlyFile: "0000_example.sql" })).rejects.toThrow(/transaction control/);
    expect(client.query).not.toHaveBeenCalled();
  });
  it("rejects invalid selection before any query", async () => {
    const client = connection();
    await expect(runMigrations(client, [source()], { onlyFile: "../absent.sql" })).rejects.toThrow(/existing migration/);
    expect(client.query).not.toHaveBeenCalled();
  });
  it("dry-run with no ledger issues only read-only controls and existence SELECT", async () => {
    const client = connection();
    expect((await runMigrations(client, [source()], { dryRun: true })).pending).toHaveLength(1);
    expect(client.query.mock.calls.map(c => c[0])).toEqual([
      "BEGIN READ ONLY", "SELECT to_regclass('public.schema_migrations') AS ledger", "ROLLBACK",
    ]);
  });
  it("dry-run with a ledger does not create, lock or modify anything", async () => {
    const client = connection([source()]);
    const result = await runMigrations(client, [source(), source("SELECT 2;", "0001_second.sql")], { dryRun: true });
    expect(result.pending.map(m => m.filename)).toEqual(["0001_second.sql"]);
    expect(client.query.mock.calls.map(c => c[0])).toEqual([
      "BEGIN READ ONLY", "SELECT to_regclass('public.schema_migrations') AS ledger", "SELECT filename, checksum FROM public.schema_migrations", "ROLLBACK",
    ]);
  });
  it("rolls back read-only inspection on failure", async () => {
    const client = connection([], s => s.includes("to_regclass"));
    await expect(runMigrations(client, [source()], { dryRun: true })).rejects.toThrow("injected failure");
    expect(client.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });
  it("body, ledger creation and original checksum insertion precede one COMMIT", async () => {
    const migration = source();
    const client = connection();
    expect((await runMigrations(client, [migration])).appliedCount).toBe(1);
    const queries = client.query.mock.calls.map(c => c[0]);
    expect(queries.filter(q => q === "BEGIN")).toHaveLength(1);
    expect(queries.filter(q => q === "COMMIT")).toHaveLength(1);
    const bodyIndex = queries.indexOf(normalizeMigrationSql(migration.body).sql);
    expect(queries.indexOf("BEGIN")).toBeLessThan(queries.findIndex(q => q.startsWith("CREATE TABLE")));
    expect(bodyIndex).toBeLessThan(queries.findIndex(q => q.startsWith("INSERT INTO public.schema_migrations")));
    expect(client.query.mock.calls.find(c => c[0].startsWith("INSERT"))?.[1]).toEqual([migration.filename, migrationChecksum(migration.body)]);
    expect(queries.at(-1)).toContain("pg_advisory_unlock");
  });
  it.each(["CREATE TABLE IF NOT EXISTS", "CREATE TABLE example", "INSERT INTO public.schema_migrations", "COMMIT"])("rolls back on %s failure without later migrations", async fragment => {
    const client = connection([], sql => sql.includes(fragment));
    await expect(runMigrations(client, [source(), source("SELECT 'later';", "0001_later.sql")])).rejects.toThrow("injected failure");
    expect(client.query.mock.calls.map(c => c[0]).slice(-2)).toEqual(["ROLLBACK", "SELECT pg_advisory_unlock(727027, 1)"]);
    expect(client.query.mock.calls.some(c => c[0].includes("'later'"))).toBe(false);
  });
  it("retains earlier committed migrations when a subsequent file fails", async () => {
    const client = connection([], sql => sql === "SELECT 'fail';");
    await expect(runMigrations(client, [source(), source("SELECT 'fail';", "0001_fail.sql")])).rejects.toThrow();
    expect(client.query.mock.calls.filter(c => c[0] === "COMMIT")).toHaveLength(1);
    expect(client.query.mock.calls.filter(c => c[0] === "ROLLBACK")).toHaveLength(1);
  });
  it("does not rerun applied files", async () => {
    const client = connection([source()]);
    expect((await runMigrations(client, [source()])).appliedCount).toBe(0);
    expect(client.query.mock.calls.some(c => c[0] === "BEGIN")).toBe(false);
  });
  it("checks drift in unselected history before writes", async () => {
    const client = connection([source("SELECT 'old';")]);
    await expect(runMigrations(client, [source(), source("SELECT 2;", "0001_next.sql")], { onlyFile: "0001_next.sql" })).rejects.toThrow(/checksum changed/);
    expect(client.query.mock.calls.some(c => c[0].startsWith("CREATE"))).toBe(false);
  });
  it("rejects unknown ledger history rather than silently forgetting it", () => {
    expect(() => planMigrations(preflightMigrations([source()]), new Map([["0001_lost.sql", "old"]]))).toThrow(/missing from inventory/);
  });
  it("reports ledger gaps in dry-run and blocks default or gap-targeted apply", async () => {
    const next = source("SELECT 2;", "0001_next.sql");
    const result = await runMigrations(connection([next]), [source(), next], { dryRun: true });
    expect(result.gaps).toEqual([source().filename]);
    for (const options of [{}, { onlyFile: source().filename }]) {
      const client = connection([next]);
      await expect(runMigrations(client, [source(), next], options)).rejects.toThrow(/ledger gap/);
      expect(client.query.mock.calls.some(c => c[0] === "BEGIN")).toBe(false);
    }
  });
  it("explicit later-only selection reports but never fills an older gap", async () => {
    const next = source("SELECT 2;", "0001_next.sql");
    const last = source("SELECT 3;", "0002_last.sql");
    const client = connection([next]);
    const result = await runMigrations(client, [source(), next, last], { onlyFile: last.filename });
    expect(result.gaps).toEqual([source().filename]);
    expect(result.appliedCount).toBe(1);
    expect(client.query.mock.calls.find(c => c[0].startsWith("INSERT"))?.[1]?.[0]).toBe(last.filename);
  });
});

describe("offline inventory and immutable historical SQL", () => {
  const sources = readMigrationSources(resolve(import.meta.dirname, "../migrations"));
  it("preflights ALL SQL including historical unmatched 0016 terminal COMMIT", () => {
    const inventory = preflightMigrations(sources);
    expect(inventory).toHaveLength(sources.length);
    expect(inventory.find(m => m.filename.startsWith("0016_"))?.removedControls).toBe(1);
    expect(inventory.find(m => m.filename.startsWith("0038_"))?.removedControls).toBe(0);
    expect(inventory.every(m => m.statementCount > 0)).toBe(true);
  });
  it("exception cannot apply to changed 0016 or another filename", () => {
    const original = sources.find(m => m.filename.startsWith("0016_"))!;
    expect(() => preflightMigrations([{ ...original, body: original.body + "\n" }])).toThrow(/transaction control/);
    expect(() => preflightMigrations([{ ...original, filename: "0099_other.sql" }])).toThrow(/transaction control/);
  });
  it("historical inventory hashes match the read-only pre-edit baseline", () => {
    const hashes = "bd2b94f3d2289518 26067a0bee61ac3a e2dd0012a4ab2e65 d1c2d700f745e7a0 779526f9f5eeb6c4 877f3197287317fb ac814501ae1b0d78 f10456c4951a19fb b096783d52518a78 3281a04783dda9c4 5247564fc5bbd0bd f4c863bcbd76bb2a 7b6e976630b6a608 86da84d5117aac4f ec5b8f5f67017f2a 8c1429461160092e ccab8d8c6ce43579 13d20a29bd422041 ec6a8abbf18eec95 38a3a890f8eec9ee 76b29abbd668133c bb25561efb0a16f9 a5a289395263dadf 5c0933147779f53e 98830b70dca86d6e 75bbe23cddb79c00 53f4e1a1b8b9a3c1 30f679c738c07871 ecb77728db896159 159898b15d9b9628 1174e7427b8211a7 5434586818a90707 de5bfc7795180fa6 cf0af2d38ef69367 7c6a6db5fd14af0a feb422df6780ac7d 6dc6738d14c1fcb4".split(" ");
    expect(sources.filter(m => m.filename < "0038").map(m => migrationChecksum(m.body))).toEqual(hashes);
    expect(sources.some(m => m.filename.startsWith("0031"))).toBe(false);
  });
  it("rejects duplicate numbering and invalid filenames", () => {
    expect(() => preflightMigrations([source(), source("SELECT 1", "0000_second.sql")])).toThrow(/duplicate/);
    expect(() => preflightMigrations([source("SELECT 1", "../bad.sql")])).toThrow(/Invalid/);
  });
  it("0038 static contract retains guarded structural repair and ordered row locks (not SQL execution proof)", () => {
    const sql = sources.find(m => m.filename.startsWith("0038_"))!.body;
    expect(sql).toContain("SET LOCAL row_security = off");
    expect(sql).toContain("ORDER BY id FOR UPDATE");
    expect(sql).toContain("entry -> 'weight' IS DISTINCT FROM '0.7'::jsonb");
    expect(sql).toContain("candidate := entry -> 'keyword'");
    expect(sql).toContain("repaired IS DISTINCT FROM profile_row.keywords");
    expect(sql).not.toMatch(/::(?:numeric|integer)|->>\s*'[^']*'\s*\)?\s*::jsonb|DELETE FROM|TRUNCATE/);
  });
  it("CLI has no implicit environment loading or app imports", () => {
    const cli = readFileSync(resolve(import.meta.dirname, "../script/migrate.ts"), "utf8");
    expect(cli).not.toContain('import("dotenv');
    expect(cli).not.toContain('from "../server');
    expect(cli.indexOf("if (options.preflight)")).toBeLessThan(cli.indexOf('await import("pg")'));
  });
});

describe("explicit CLI and disposable acceptance guards", () => {
  it("actual acceptance entry point fails before importing pg when not authorized", async () => {
    await expect(runMigrationAcceptance({})).rejects.toThrow(/Requires MIGRATION_ACCEPTANCE/);
  });
  it.each(["--oops", "--only=", "--dry=yes"])("rejects bad option %s", arg => expect(() => parseMigrationArgs([arg])).toThrow());
  it("accepts existing flags and rejects duplicate flags", () => {
    expect(parseMigrationArgs(["--no-dotenv", "--preflight", "--dry", "--only=0022_test.sql"])).toEqual({ preflight: true, dryRun: true, onlyFile: "0022_test.sql" });
    expect(() => parseMigrationArgs(["--dry", "--dry"])).toThrow(/Duplicate/);
  });
  it.each([undefined, "", "not a url", "postgresql://localhost:5433/test", "postgresql://owner@localhost/test", "postgresql://owner@localhost:5433/", "https://owner@localhost:5433/test", "postgresql://owner@localhost:5433/test?host=remote", "postgresql://owner@localhost:5433/test?options=-cfoo", "postgresql://owner@localhost:5433/test?sslmode=prefer"])("rejects implicit or overridden connection %s", url => expect(() => migrationConnectionOptions(url)).toThrow());
  it("constructs explicit connection fields instead of inheriting PG* defaults", () => {
    const config = migrationConnectionOptions("postgresql://owner@localhost:5433/test");
    expect(config).toMatchObject({ host: "localhost", port: 5433, user: "owner", database: "test", ssl: false });
    expect(config.password()).toBe("");
    expect(migrationConnectionOptions("postgresql://owner:fake%20password@localhost:5433/test").password()).toBe("fake password");
  });
  const env = { MIGRATION_ACCEPTANCE: "fresh-chain", MIGRATION_TEST_DATABASE_URL: "postgresql://owner@localhost:5433/tsp_migration_rehearsal_test", MIGRATION_CONFIRM_DATABASE: "tsp_migration_rehearsal_test" };
  it("acceptance pins a confirmed disposable loopback target", () => {
    expect(acceptanceConnectionOptions(env).host).toBe("127.0.0.1");
  });
  it("accepts the explicitly confirmed isolated acceptance database", () => {
    expect(acceptanceConnectionOptions({
      ...env, MIGRATION_TEST_DATABASE_URL: "postgresql://owner@127.0.0.1:55439/thesocialpundit_acceptance_test",
      MIGRATION_CONFIRM_DATABASE: "thesocialpundit_acceptance_test",
    })).toMatchObject({ host: "127.0.0.1", port: 55439, database: "thesocialpundit_acceptance_test" });
  });
  it.each(["127.0.0.1:5432", "127.0.0.1:5433", "localhost:55439", "remote:55439"])("rejects isolated acceptance on unsafe endpoint %s", endpoint => {
    expect(() => acceptanceConnectionOptions({
      ...env, MIGRATION_TEST_DATABASE_URL: `postgresql://owner@${endpoint}/thesocialpundit_acceptance_test`,
      MIGRATION_CONFIRM_DATABASE: "thesocialpundit_acceptance_test",
    })).toThrow();
  });
  it.each([
    {}, { MIGRATION_ACCEPTANCE: "true" }, { MIGRATION_TEST_DATABASE_URL: undefined },
    { MIGRATION_TEST_DATABASE_URL: "postgresql://owner@localhost:5433/thesocialpundit_test" },
    { MIGRATION_TEST_DATABASE_URL: "postgresql://owner@remote:5433/tsp_migration_rehearsal_test" },
    { MIGRATION_CONFIRM_DATABASE: "different" },
    { MIGRATION_TEST_DATABASE_URL: "postgresql://owner@localhost:5433/tsp_migration_rehearsal_test?host=remote" },
  ].map((override, index) => ({ override, index })))("acceptance rejects missing/unsafe prerequisites $index", ({ override, index }) => {
    expect(() => acceptanceConnectionOptions(index === 0 ? {} : { ...env, ...override })).toThrow();
  });
});