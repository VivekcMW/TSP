import { migrationConnectionOptions } from "./migration-runner";

/** No fallback to app/owner URLs and no automatic provisioning. */
export function acceptanceConnectionOptions(env: Record<string, string | undefined>) {
  if (env.MIGRATION_ACCEPTANCE !== "fresh-chain") throw new Error("Requires MIGRATION_ACCEPTANCE=fresh-chain and parent authorization");
  const config = migrationConnectionOptions(env.MIGRATION_TEST_DATABASE_URL);
  const isolatedAcceptance = config.database === "thesocialpundit_acceptance_test" &&
    config.host === "127.0.0.1" && ![5432, 5433].includes(config.port);
  if (!["127.0.0.1", "::1", "localhost"].includes(config.host) ||
      (!/^tsp_migration_[a-z0-9_]+_test$/.test(config.database) && !isolatedAcceptance) ||
      env.MIGRATION_CONFIRM_DATABASE !== config.database) {
    throw new Error("Requires confirmed loopback tsp_migration_<disposable-name>_test or isolated thesocialpundit_acceptance_test database");
  }
  // Pin localhost to a literal loopback address, never DNS or ambient PG* overrides.
  return { ...config, host: config.host === "localhost" ? "127.0.0.1" : config.host };
}