import type { PoolConfig } from "pg";

const settings = {
  DB_POOL_MAX: { key: "max", fallback: 10, max: 100 },
  DB_CONNECTION_TIMEOUT_MS: { key: "connectionTimeoutMillis", fallback: 5000, max: 30000 },
  DB_IDLE_TIMEOUT_MS: { key: "idleTimeoutMillis", fallback: 30000, max: 300000 },
  DB_STATEMENT_TIMEOUT_MS: { key: "statement_timeout", fallback: 30000, max: 300000 },
  DB_IDLE_TRANSACTION_TIMEOUT_MS: { key: "idle_in_transaction_session_timeout", fallback: 30000, max: 300000 },
} as const;

/** An idle client dropped by the server (Neon does this) is re-emitted on the pool;
 * unheard, that 'error' event exits the process. The pool replaces the client itself.
 */
export function watchIdleClientErrors(pool: { on(event: "error", listener: (error: Error) => void): unknown }, log: (message: string) => void = console.warn) {
  pool.on("error", error => log(`[db] idle connection dropped: ${error.message}`));
}

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