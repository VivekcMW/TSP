import { describe, expect, it } from "vitest";
import { requireLocalTestDatabase } from "./database-safety";

const runtime = "postgresql://tsp_app:localtestpass@127.0.0.1:60053/thesocialpundit_acceptance_test";
const owner = "postgresql://fixture_owner@127.0.0.1:60053/thesocialpundit_acceptance_test";
const env = { DATABASE_URL: runtime, TEST_DATABASE_URL: runtime, OWNER_TEST_DATABASE_URL: owner, OWNER_DATABASE_URL: owner };
describe("explicit local integration target", () => {
  it("accepts the separate acceptance cluster", () => {
    expect(requireLocalTestDatabase(env)).toEqual({ database: "thesocialpundit_acceptance_test", port: 60053 });
  });
  it("retains the previous local test target", () => {
    const replace = (value: string) => value.replace("127.0.0.1:60053/thesocialpundit_acceptance_test", "localhost:5433/thesocialpundit_test");
    expect(requireLocalTestDatabase(Object.fromEntries(Object.entries(env).map(([key, value]) => [key, replace(value)]))))
      .toEqual({ database: "thesocialpundit_test", port: 5433 });
  });
  it.each(["5432", "5433", "0", ""])("rejects acceptance on unsafe port %s", port => {
    const replace = (value: string) => value.replace(":60053", port ? `:${port}` : "");
    expect(() => requireLocalTestDatabase(Object.fromEntries(Object.entries(env).map(([key, value]) => [key, replace(value)])))).toThrow();
  });
  it.each([
    { DATABASE_URL: undefined }, { TEST_DATABASE_URL: undefined }, { OWNER_TEST_DATABASE_URL: undefined },
    { PGOPTIONS: "-c role=postgres" }, { DATABASE_URL: owner }, { OWNER_DATABASE_URL: runtime },
    { TEST_DATABASE_URL: `${runtime}?host=remote.test` }, { OWNER_TEST_DATABASE_URL: `${owner}#` },
    { OWNER_TEST_DATABASE_URL: owner.replace("60053", "60054") },
    { TEST_DATABASE_URL: runtime.replace("tsp_app", "postgres") },
    { OWNER_TEST_DATABASE_URL: runtime },
  ])("rejects missing, mismatched or overriding configuration %#", overrides => {
    expect(() => requireLocalTestDatabase({ ...env, ...overrides })).toThrow();
  });
  it.each(["localhost", "remote.test", "postgres"])("rejects acceptance host %s", host => {
    expect(() => requireLocalTestDatabase(Object.fromEntries(Object.entries(env).map(([key, value]) => [key, value.replace("127.0.0.1", host)])))).toThrow();
  });
});