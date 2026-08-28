import "dotenv/config";
import { createHash } from "crypto";
import { readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import pg from "pg";

/**
 * Applies the SQL files in migrations/ in filename order, once each.
 *
 * Written rather than using drizzle-kit's migrator because this schema needs
 * statements drizzle-kit cannot generate — a database role, GRANTs, and
 * Row-Level Security policies — and because `drizzle-kit push` diffs against
 * the live database, which is a development convenience, not a deploy
 * mechanism: it cannot express a backfill, and it prompts before destructive
 * changes.
 *
 * Guarantees:
 *   - each file runs inside a transaction, so a failure leaves nothing partial
 *   - each file runs at most once, tracked in schema_migrations
 *   - an already-applied file whose contents changed is a hard error, since
 *     editing an applied migration means environments have silently diverged
 *
 * Runs as the OWNER connection: migrations create roles and policies, which
 * the restricted application role cannot do.
 *
 *   npm run db:migrate           apply pending migrations
 *   npm run db:migrate -- --dry  list what would run, change nothing
 */

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../migrations");

const url =
  process.env.OWNER_DATABASE_URL ??
  process.env.DATABASE_URL ??
  (() => {
    throw new Error("Set OWNER_DATABASE_URL (preferred) or DATABASE_URL");
  })();

const dryRun = process.argv.includes("--dry");

function checksum(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    text PRIMARY KEY,
        checksum    text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ filename: string; checksum: string }>(
      "SELECT filename, checksum FROM schema_migrations",
    );
    const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      console.log("No migrations found.");
      return;
    }

    // Verify history before applying anything, so a tampered migration stops
    // the run rather than being noticed halfway through.
    const drifted = files.filter((f) => {
      const previous = applied.get(f);
      return previous !== undefined && previous !== checksum(readFileSync(resolve(MIGRATIONS_DIR, f), "utf8"));
    });
    if (drifted.length > 0) {
      throw new Error(
        `These migrations were already applied but their contents changed: ${drifted.join(", ")}. ` +
          "Add a new migration instead of editing an applied one.",
      );
    }

    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log(`Up to date — ${files.length} migration(s) already applied.`);
      return;
    }

    if (dryRun) {
      console.log(`Would apply ${pending.length} migration(s):`);
      pending.forEach((f) => console.log(`  ${f}`));
      return;
    }

    for (const file of pending) {
      const body = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
      process.stdout.write(`applying ${file} ... `);
      try {
        await client.query("BEGIN");
        await client.query(body);
        await client.query(
          "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
          [file, checksum(body)],
        );
        await client.query("COMMIT");
        console.log("ok");
      } catch (error) {
        await client.query("ROLLBACK");
        console.log("FAILED");
        throw error;
      }
    }

    console.log(`Applied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("\nMigration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
