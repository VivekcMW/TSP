import "dotenv/config";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { readMigrationSources, runMigrations } from "../script/migration-runner";

const owner = new URL(process.env.OWNER_DATABASE_URL ?? "");
const application = new URL(process.env.DATABASE_URL ?? "");
for (const url of [owner, application]) {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.endsWith("_dev")) throw new Error("Acceptance requires explicit loopback *_dev source connections");
}
if (owner.host !== application.host || owner.pathname !== application.pathname) throw new Error("Owner/application targets differ");
const name = `tsp_admin_acceptance_${randomBytes(8).toString("hex")}_test`;
const ownerTarget = new URL(owner); ownerTarget.pathname = `/${name}`;
const appTarget = new URL(application); appTarget.pathname = `/${name}`;
const controller = new pg.Client({ connectionString: owner.toString() });
await controller.connect();
if (!ownerTarget.username) {
  const identity = await controller.query<{ name: string }>("select current_user as name");
  ownerTarget.username = identity.rows[0].name;
}
let created = false;
try {
  await controller.query(`CREATE DATABASE "${name}"`);
  created = true;
  const migrationClient = new pg.Client({ connectionString: ownerTarget.toString() });
  await migrationClient.connect();
  try {
    const result = await runMigrations(migrationClient, readMigrationSources(`${process.cwd()}/migrations`));
    console.log(`Disposable local acceptance database created; ${result.appliedCount} migrations applied.`);
  } finally { await migrationClient.end(); }
  const result = spawnSync("pnpm", ["test", "server/routes/admin-roadmap.local.test.ts"], {
    stdio: "inherit", env: { ...process.env, NODE_ENV: "test", ADMIN_ACCEPTANCE_ENABLED: "true",
      TEST_DATABASE_URL: appTarget.toString(), OWNER_TEST_DATABASE_URL: ownerTarget.toString(),
      DATABASE_URL: appTarget.toString(), OWNER_DATABASE_URL: ownerTarget.toString(),
      REDIS_URL: "", DEV_AUTH_BYPASS: "", AI_OBSERVATIONS_ENABLED: "false", ADMIN_OPERATIONS_ENABLED: "false",
      EMAIL_QUEUE_ENABLED: "false", BACKGROUND_JOBS_ENABLED: "false", PLAN_LIMITS_ENABLED: "true" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Local admin acceptance failed");
} finally {
  if (created) {
    // This name was generated in this process, never supplied by environment.
    await controller.query(`DROP DATABASE "${name}"`);
    console.log("Disposable acceptance database removed; development data was not used as fixtures.");
  }
  await controller.end();
}
