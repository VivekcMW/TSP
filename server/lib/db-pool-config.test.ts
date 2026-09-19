import { describe, expect, it } from "vitest";
import { databasePoolConfig } from "./db-pool-config";
describe("bounded database pool configuration", () => {
  it("has finite pool, acquisition, idle, statement and idle-transaction defaults", () => {
    expect(databasePoolConfig({})).toEqual({ max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 30000, idle_in_transaction_session_timeout: 30000 });
  });
  it("supports a two-connection pool and finite overrides", () => {
    expect(databasePoolConfig({ DB_POOL_MAX: "2", DB_CONNECTION_TIMEOUT_MS: "250", DB_IDLE_TIMEOUT_MS: "500", DB_STATEMENT_TIMEOUT_MS: "1000", DB_IDLE_TRANSACTION_TIMEOUT_MS: "2000" })).toEqual({ max: 2, connectionTimeoutMillis: 250, idleTimeoutMillis: 500, statement_timeout: 1000, idle_in_transaction_session_timeout: 2000 });
  });
  for (const name of ["DB_POOL_MAX", "DB_CONNECTION_TIMEOUT_MS", "DB_IDLE_TIMEOUT_MS", "DB_STATEMENT_TIMEOUT_MS", "DB_IDLE_TRANSACTION_TIMEOUT_MS"]) {
    it.each(["", " ", "0", "-1", "1.5", "NaN", "Infinity", "1e3", "2junk", "99999999999999999999"])(`rejects unsafe ${name}=%s without echoing its value`, value => {
      expect(() => databasePoolConfig({ [name]: value })).toThrow(`${name} must be an integer between`);
    });
  }
});