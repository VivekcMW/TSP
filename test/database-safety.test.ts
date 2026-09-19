import { describe, expect, it } from "vitest";
import { resolveTestDatabaseUrls } from "./database-safety";

const runtime = "postgresql://tsp_app:runtime-secret@localhost:5433/thesocialpundit_test";
const owner = "postgresql://local_owner:owner-secret@localhost:5433/thesocialpundit_test";
const valid = { TEST_DATABASE_URL: runtime, OWNER_TEST_DATABASE_URL: owner };
const variables = ["TEST_DATABASE_URL", "OWNER_TEST_DATABASE_URL"] as const;

describe("test database safety", () => {
  it("returns explicit local defaults without using ambient provider settings or mutating input", () => {
    const env = Object.freeze({
      DATABASE_URL: "postgresql://provider:secret@production.example/live",
      OWNER_DATABASE_URL: "postgresql://provider:secret@production.example/live",
      PGDATABASE: "production",
      PGUSER: "provider_owner",
      PGHOST: "production.example",
      PGPORT: "9999",
    });
    expect(resolveTestDatabaseUrls(env, "local_owner")).toEqual({
      DATABASE_URL: "postgresql://tsp_app:tsp_app_local@localhost:5433/thesocialpundit_test",
      TEST_DATABASE_URL: "postgresql://tsp_app:tsp_app_local@localhost:5433/thesocialpundit_test",
      OWNER_TEST_DATABASE_URL: "postgresql://local_owner@localhost:5433/thesocialpundit_test",
    });
    expect(env.PGUSER).toBe("provider_owner");
  });

  it("accepts the actual CI connection pair unchanged", () => {
    const ci = {
      TEST_DATABASE_URL: "postgresql://tsp_app:tsp_app_local@localhost:5432/thesocialpundit_test",
      OWNER_TEST_DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/thesocialpundit_test",
    };
    expect(resolveTestDatabaseUrls(ci, "runner")).toEqual({ ...ci, DATABASE_URL: ci.TEST_DATABASE_URL });
  });

  it.each(["localhost", "127.0.0.1", "[::1]", "postgres"])("accepts dedicated tsp_test on %s", (host) => {
    const urls = {
      TEST_DATABASE_URL: `postgres://tsp_app:secret@${host}/tsp_test`,
      OWNER_TEST_DATABASE_URL: `postgres://postgres:secret@${host}/tsp_test`,
      PGDATABASE: "production",
      PGUSER: "provider_owner",
      PGHOST: "production.example",
      PGPORT: "9999",
    };
    const result = resolveTestDatabaseUrls(urls, "runner");
    for (const variable of variables) {
      const parsed = new URL(result[variable]);
      expect(parsed.hostname).toBe(host);
      expect(parsed.port).toBe("5432");
      expect(parsed.pathname).toBe("/tsp_test");
    }
    expect(new URL(result.DATABASE_URL).username).toBe("tsp_app");
  });

  describe.each(variables)("%s", (variable) => {
    const user = variable === "TEST_DATABASE_URL" ? "tsp_app" : "local_owner";
    const base = `postgresql://${user}:do-not-log@localhost:5433`;

    it.each([
      "", "not-a-url", "postgresql://[invalid",
      `https://${user}@localhost:5433/thesocialpundit_test`,
      `mysql://${user}@localhost:5433/thesocialpundit_test`,
      "postgresql:///thesocialpundit_test",
      "postgresql://localhost:5433/thesocialpundit_test",
      `${base}`, `${base}/`, `${base}/postgres`, `${base}/test`,
      `${base}/thesocialpundit_dev`, `${base}/production`, `${base}/test_production`,
      `${base}/contest`, `${base}/thesocialpundit_test_backup`,
      `${base}/_test`, `${base}/nested/tsp_test`, `${base}/tsp_test/`,
      `${base}/tsp%2ftsp_test`, `${base}/tsp%00_test`, `${base}/tsp_test%00production`,
      `${base}/${"a".repeat(60)}_test`,
      `${base}/thesocialpundit_test#anything`,
      ` ${base}/thesocialpundit_test`,
      `${base}/thesocialpundit_\ntest`,
      `postgresql://${user}:%ZZ@localhost:5433/thesocialpundit_test`,
      "postgresql://%00:secret@localhost:5433/thesocialpundit_test",
      `postgresql://${user}@localhost:0/thesocialpundit_test`,
    ])("rejects malformed or non-test configuration %#", (url) => {
      expect(() => resolveTestDatabaseUrls({ ...valid, [variable]: url }, "local_owner"))
        .toThrow(`Unsafe ${variable}:`);
    });

    it.each(["production.example", "db.neon.tech", "localhost.example", "10.0.0.1", "0.0.0.0", "[::]", "127.0.0.2"])(
      "rejects non-allowlisted host %s even with a test suffix", (host) => {
        expect(() => resolveTestDatabaseUrls({
          ...valid, [variable]: `postgresql://${user}:do-not-log@${host}:5433/thesocialpundit_test`,
        }, "local_owner")).toThrow(`Unsafe ${variable}:`);
      },
    );

    it.each([
      "database=production", "db=production", "dbname=production",
      "host=production.example", "hostaddr=10.0.0.1", "port=9999",
      "user=postgres", "options=-c%20role%3Dpostgres",
      "options=-c%20search_path%3Dproduction", "service=production",
      "data%62ase=production", "database=tsp_test&database=production",
      "sslmode=require", "",
    ])("rejects all query overrides: %s", (query) => {
      expect(() => resolveTestDatabaseUrls({
        ...valid, [variable]: `${base}/thesocialpundit_test?${query}`,
      }, "local_owner")).toThrow("query parameters and fragments are not allowed");
    });

    it.each(["postgresql://user:do-not-log@[invalid", `${base}/production`])(
      "does not leak credentials in errors %#", (url) => {
        let caught: unknown;
        try {
          resolveTestDatabaseUrls({ ...valid, [variable]: url }, "local_owner");
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(Error);
        expect(String(caught)).not.toContain("do-not-log");
        expect(String(caught)).not.toContain(url);
        expect((caught as Error).cause).toBeUndefined();
      },
    );
  });

  it.each(["postgres", "local_owner", "other_app"])("rejects runtime role %s", (role) => {
    expect(() => resolveTestDatabaseUrls({ ...valid, TEST_DATABASE_URL: runtime.replace("tsp_app", role) }, "local_owner"))
      .toThrow("restricted tsp_app role");
  });

  it("rejects the runtime role as fixture owner, including percent encoding", () => {
    expect(() => resolveTestDatabaseUrls({ ...valid, OWNER_TEST_DATABASE_URL: owner.replace("local_owner", "%74sp_app") }, "local_owner"))
      .toThrow("fixture owner must differ");
  });

  it.each([
    owner.replace("5433", "5432"),
    owner.replace("localhost", "postgres"),
    owner.replace("thesocialpundit_test", "other_test"),
  ])("rejects mismatched runtime/owner destinations %#", (url) => {
    expect(() => resolveTestDatabaseUrls({ ...valid, OWNER_TEST_DATABASE_URL: url }, "local_owner"))
      .toThrow("same test host, port, and database");
  });

  it("rejects ambient startup options without printing them", () => {
    expect(() => resolveTestDatabaseUrls({ ...valid, PGOPTIONS: "-c role=secret_owner" }, "local_owner"))
      .toThrow(/^Unsafe PGOPTIONS: unset it before running tests; startup overrides are not allowed\.$/);
    expect(() => resolveTestDatabaseUrls({ ...valid, PGOPTIONS: "" }, "local_owner")).not.toThrow();
  });

  it("encodes the OS username in the default owner URL", () => {
    expect(new URL(resolveTestDatabaseUrls({}, "local@owner").OWNER_TEST_DATABASE_URL).username)
      .toBe("local%40owner");
  });
});