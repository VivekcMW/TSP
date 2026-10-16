import { resolve } from "node:path";
import { migrationConnectionOptions, parseMigrationArgs, preflightMigrations, readMigrationSources, runMigrations } from "./migration-runner";

// No dotenv, application imports, implicit pools or connections during preflight.
async function main() {
  const options = parseMigrationArgs(process.argv.slice(2));
  const sources = readMigrationSources(resolve(import.meta.dirname, "../migrations"));
  const inventory = preflightMigrations(sources);
  if (options.onlyFile !== undefined && !inventory.some(m => m.filename === options.onlyFile)) throw new Error("--only must name an existing migration file");
  if (options.preflight) {
    for (const migration of inventory) console.log(`${migration.filename} ${migration.checksum} statements=${migration.statementCount} normalized-controls=${migration.removedControls}`);
    console.log(`Offline preflight passed: ${inventory.length} files. No database/schema acceptance implied.`);
    return;
  }
  const config = migrationConnectionOptions(process.env.OWNER_DATABASE_URL ?? process.env.DATABASE_URL);
  const { default: pg } = await import("pg");
  const client = new pg.Client(config);
  try {
    await client.connect();
    const result = await runMigrations(client, sources, options);
    if (result.gaps.length) console.warn(`Unreconciled ledger gaps: ${result.gaps.join(", ")}`);
    if (options.onlyFile) console.warn("Explicit --only selection does not validate skipped dependencies or reconcile ledger gaps.");
    console.log(`${options.dryRun ? "Would apply" : "Applied"} ${options.dryRun ? result.pending.length : result.appliedCount} migration(s).`);
    if (options.dryRun) result.pending.forEach(m => console.log(`  ${m.filename}`));
  } finally { await client.end(); }
}

try {
  await main();
} catch (error) {
  console.error("Migration failed:", error instanceof Error && !Reflect.has(error, "code") ? error.message : "database operation failed; inspect controlled database diagnostics");
  process.exitCode = 1;
}
