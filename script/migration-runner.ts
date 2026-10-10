import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeMigrationSql } from "./migration-sql";

export type MigrationSource = { filename: string; body: string };
export type Migration = MigrationSource & ReturnType<typeof normalizeMigrationSql> & { checksum: string };
export interface MigrationConnection {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
export const migrationChecksum = (body: string) => createHash("sha256").update(body).digest("hex").slice(0, 16);

export function preflightMigrations(sources: MigrationSource[]): Migration[] {
  const seen = new Set<string>();
  return [...sources].sort((a, b) => a.filename.localeCompare(b.filename)).map(source => {
    if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(source.filename) || seen.has(source.filename.slice(0, 4))) {
      throw new Error(`Invalid or duplicate migration number: ${source.filename}`);
    }
    seen.add(source.filename.slice(0, 4));
    const checksum = migrationChecksum(source.body);
    // Reviewed historical orphan COMMIT. Never generalize to new files.
    const historical = source.filename === "0016_profile_social_links_rls_fix.sql" && checksum === "ccab8d8c6ce43579";
    try {
      return { ...source, checksum, ...normalizeMigrationSql(source.body, historical) };
    } catch (error) {
      throw new Error(`${source.filename}: ${error instanceof Error ? error.message : "SQL preflight failed"}`);
    }
  });
}

export function readMigrationSources(directory: string): MigrationSource[] {
  return readdirSync(directory).filter(f => f.endsWith(".sql")).sort((a, b) => a.localeCompare(b))
    .map(filename => ({ filename, body: readFileSync(resolve(directory, filename), "utf8") }));
}

export function parseMigrationArgs(args: string[]) {
  const options = { dryRun: false, preflight: false, onlyFile: undefined as string | undefined };
  const seen = new Set<string>();
  for (const arg of args) {
    const key = arg.split("=")[0];
    if (seen.has(key)) throw new Error(`Duplicate option: ${key}`);
    seen.add(key);
    if (arg === "--dry") options.dryRun = true;
    else if (arg === "--preflight") options.preflight = true;
    else if (arg === "--no-dotenv") { /* Compatibility: dotenv is never loaded now. */ }
    else if (arg.startsWith("--only=") && arg.slice(7)) options.onlyFile = arg.slice(7);
    else throw new Error("Unknown or empty migration option");
  }
  return options;
}

export function migrationConnectionOptions(value: string | undefined) {
  if (!value) throw new Error("Supply an explicit OWNER_DATABASE_URL or DATABASE_URL; dotenv is not loaded");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Invalid explicit PostgreSQL URL"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username ||
      !url.port || Number(url.port) < 1 || !/^\/[A-Za-z0-9_-]+$/.test(url.pathname) || url.hash ||
      [...url.searchParams.keys()].some(k => k !== "sslmode") || url.searchParams.getAll("sslmode").length > 1) {
    throw new Error("PostgreSQL URL requires explicit user, host, port, database; only sslmode is supported");
  }
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode && !["disable", "require", "verify-full"].includes(sslmode)) throw new Error("Unsupported sslmode");
  return {
    host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port), user: decodeURIComponent(url.username),
    // A function remains truthy even for trust-auth's empty password; pg must
    // not fall back to PGPASSWORD or a pgpass file for this explicit target.
    password: () => decodeURIComponent(url.password), database: url.pathname.slice(1),
    ssl: sslmode && sslmode !== "disable" ? { rejectUnauthorized: true } : false as const,
    application_name: "tsp-migrate", client_encoding: "UTF8",
    options: "-c standard_conforming_strings=on -c search_path=public",
    connectionTimeoutMillis: 10_000,
  };
}

const ledgerDdl = `CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename text PRIMARY KEY, checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

async function readLedger(client: MigrationConnection) {
  const existence = await client.query("SELECT to_regclass('public.schema_migrations') AS ledger");
  if (existence.rows[0]?.ledger == null) return new Map<string, string>();
  const result = await client.query("SELECT filename, checksum FROM public.schema_migrations");
  return new Map(result.rows.map(row => {
    if (typeof row.filename !== "string" || typeof row.checksum !== "string") throw new Error("Invalid migration ledger");
    return [row.filename, row.checksum];
  }));
}

export function planMigrations(migrations: Migration[], applied: Map<string, string>, onlyFile?: string) {
  if (onlyFile !== undefined && !migrations.some(m => m.filename === onlyFile)) throw new Error("--only must name an existing migration file");
  for (const [filename, checksum] of applied) {
    const migration = migrations.find(m => m.filename === filename);
    if (!migration) throw new Error(`Applied migration missing from inventory: ${filename}`);
    if (migration.checksum !== checksum) throw new Error(`Applied migration checksum changed: ${filename}; add a new migration instead`);
  }
  const lastApplied = migrations.reduce((last, m, index) => applied.has(m.filename) ? index : last, -1);
  const gaps = migrations.filter((m, index) => index < lastApplied && !applied.has(m.filename)).map(m => m.filename);
  return { gaps, pending: migrations.filter(m => !applied.has(m.filename) && (onlyFile === undefined || m.filename === onlyFile)) };
}

/** ONE dedicated idle connection, never Pool.query. Caller owns connect/end.
 * Preflight precedes every query; checksums always cover original bytes.
 */
export async function runMigrations(client: MigrationConnection, sources: MigrationSource[], options: { dryRun?: boolean; onlyFile?: string } = {}) {
  const migrations = preflightMigrations(sources);
  if (options.onlyFile !== undefined && !migrations.some(m => m.filename === options.onlyFile)) throw new Error("--only must name an existing migration file");
  if (options.dryRun) {
    await client.query("BEGIN READ ONLY");
    try {
      return { ...planMigrations(migrations, await readLedger(client), options.onlyFile), appliedCount: 0 };
    } finally { await client.query("ROLLBACK"); }
  }
  // Session lock spans per-file commits, serializing cooperating runners.
  await client.query("SELECT pg_advisory_lock(727027, 1)");
  try {
    const plan = planMigrations(migrations, await readLedger(client), options.onlyFile);
    if (plan.gaps.length && (!options.onlyFile || plan.gaps.includes(options.onlyFile))) {
      throw new Error(`Unreconciled migration ledger gap: ${plan.gaps.join(", ")}; controlled rehearsal and reviewed reconciliation required`);
    }
    for (const migration of plan.pending) {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL standard_conforming_strings = on");
        await client.query("SET LOCAL search_path = public");
        await client.query(ledgerDdl);
        await client.query(migration.sql);
        await client.query("INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2)", [migration.filename, migration.checksum]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return { ...plan, appliedCount: plan.pending.length };
  } finally { await client.query("SELECT pg_advisory_unlock(727027, 1)"); }
}