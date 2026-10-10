// No dotenv import. Operators explicitly supply an approved environment.
import { pathToFileURL } from "node:url";

export function parseMediaMaintenanceArgs(args: string[]) {
  const [operation, ...rest] = args;
  if (!["migrate", "orphans", "repair"].includes(operation)) throw new Error("Choose migrate, orphans, or repair");
  const allowed = new Set(["--tenant", "--user", "--backend", "--after"]);
  const values: Record<string, string> = {}; let apply = false;
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (key === "--apply" && !apply) { apply = true; continue; }
    if (!allowed.has(key) || values[key] !== undefined || !rest[i + 1] || rest[i + 1].startsWith("--")) throw new Error("Invalid maintenance arguments");
    values[key] = rest[++i];
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(values["--tenant"] ?? "") || !/^[A-Za-z0-9_-]{1,128}$/.test(values["--user"] ?? "")) throw new Error("Explicit tenant and user required");
  const backend = values["--backend"];
  if (operation !== "repair" && backend !== "s3" && backend !== "r2") throw new Error("Explicit s3 or r2 target required");
  return { operation, scope: { tenantId: values["--tenant"], userId: values["--user"] }, backend: backend as "s3" | "r2", options: { dryRun: !apply, after: values["--after"] } };
}

async function main() {
  const args = parseMediaMaintenanceArgs(process.argv.slice(2));
  const { pool } = await import("../server/db");
  try {
    const { migrateLocalMedia, cleanMediaOrphans, repairMediaDeletions } = await import("../server/services/media-maintenance");
    const result = args.operation === "repair" ? await repairMediaDeletions(args.scope, args.options)
      : args.operation === "migrate" ? await migrateLocalMedia(args.scope, args.backend, args.options)
      : await cleanMediaOrphans(args.scope, args.backend, args.options);
    console.info(JSON.stringify(result));
  } finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("Media maintenance failed; no credentials logged. Re-run the same bounded page after investigation."); process.exitCode = 1; });
}