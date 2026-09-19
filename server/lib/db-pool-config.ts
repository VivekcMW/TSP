import type { PoolConfig } from "pg";

const settings = {
  DB_POOL_MAX: { key: "max", fallback: 10, max: 100 },
  DB_CONNECTION_TIMEOUT_MS: { key: "connectionTimeoutMillis", fallback: 5000, max: 30000 },
  DB_IDLE_TIMEOUT_MS: { key: "idleTimeoutMillis", fallback: 30000, max: 300000 },
  DB_STATEMENT_TIMEOUT_MS: { key: "statement_timeout", fallback: 30000, max: 300000 },
  DB_IDLE_TRANSACTION_TIMEOUT_MS: { key: "idle_in_transaction_session_timeout", fallback: 30000, max: 300000 },
} as const;

/** pg's zero defaults mean unlimited waits. Invalid overrides must not disable
 * defenses, even in entrypoints that don't run production env verification.
 */
export function databasePoolConfig(env: NodeJS.ProcessEnv): PoolConfig {
  const config: PoolConfig = {};
  for (const [name, setting] of Object.entries(settings)) {
    const raw = env[name];
    const value = raw === undefined ? setting.fallback : Number(raw);
    if ((raw !== undefined && !/^\d+$/.test(raw)) || !Number.isSafeInteger(value) || value < 1 || value > setting.max) {
      throw new Error(`${name} must be an integer between 1 and ${setting.max}`);
    }
    config[setting.key] = value;
  }
  return config;
}