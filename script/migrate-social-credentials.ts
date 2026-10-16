/** Explicit, one-page operator task. Never reads dotenv or runs at startup. */
export {};
const args = process.argv.slice(2);
function option(name: string) { return args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3); }

async function main() {
  if (args.some(arg => !/^(--apply|--rotate|--(?:tenant|user|after|limit|confirm-database)=.+)$/.test(arg))) throw new Error("Invalid options");
  const connection = process.env.DATABASE_URL;
  const tenantId = option("tenant");
  const userId = option("user");
  if (!connection || !tenantId || !userId) throw new Error("Explicit target and scope required");
  const target = new URL(connection);
  if (!["postgres:", "postgresql:"].includes(target.protocol) || !target.pathname.slice(1)) throw new Error("Invalid database target");
  // Require an explicit target acknowledgement even for dry-run. Credentials and
  // hostnames are never printed. Use the restricted runtime role, not an owner.
  if (option("confirm-database") !== decodeURIComponent(target.pathname.slice(1))) throw new Error("Database acknowledgement required");
  const { storage } = await import("../server/storage");
  const { pool } = await import("../server/db");
  try {
    const result = await storage.migrateSocialAccountCredentials({ tenantId, userId }, {
      dryRun: !args.includes("--apply"), rotate: args.includes("--rotate"),
      afterId: option("after"), limit: option("limit") === undefined ? undefined : Number(option("limit")),
    });
    console.log(JSON.stringify(result)); // Counts/cursor only, never rows or errors.
  } finally { await pool.end(); }
}

try { await main(); } catch {
  console.error("Credential migration failed. Check explicit target, scope, options and encryption configuration; no secrets are logged.");
  process.exitCode = 1;
}