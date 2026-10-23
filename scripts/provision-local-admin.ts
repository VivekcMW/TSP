import "dotenv/config";
import pg from "pg";
import { ADMIN_EMAILS } from "../shared/admin-access";

const email = process.argv[2]?.trim().toLowerCase();
const operation = process.argv[3];
if (!ADMIN_EMAILS.some(allowed => allowed === email) || !["grant", "revoke"].includes(operation)) {
  throw new Error("Usage: pnpm exec tsx scripts/provision-local-admin.ts <approved-email> <grant|revoke>");
}
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const target = new URL(connectionString);
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
  || !/^\/[a-z0-9_]+_(dev|test)$/.test(target.pathname)) {
  throw new Error("This command only provisions a verified account in an explicitly local *_dev or *_test database");
}
const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query("BEGIN");
  const { rows } = await client.query<{ id: string; email_verified: boolean }>("select id, email_verified from users where lower(email) = $1 for update", [email]);
  if (rows.length !== 1 || (operation === "grant" && !rows[0].email_verified)) {
    throw new Error("Exactly one existing verified account is required for a grant. Sign up and verify ownership first.");
  }
  await client.query("update users set platform_role = $1, updated_at = now() where id = $2",
    [operation === "grant" ? "platform_admin" : null, rows[0].id]);
  await client.query(`insert into audit_log(action, resource_type, resource_id, justification, metadata)
    values ($1, 'user', $2, 'Explicit local administrator provisioning', $3::jsonb)`,
    [`staff.local.${operation}`, rows[0].id, JSON.stringify({ local: true, operator: process.env.USER ?? "local-operator" })]);
  await client.query("COMMIT");
  console.log(`Local staff role ${operation === "grant" ? "granted" : "revoked"}. No passwords or verification status were changed.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally { await client.end(); }
