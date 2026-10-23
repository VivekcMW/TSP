import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

// Not executed during implementation. This applies the exact SQL ONLY inside
// a freshly named scratch schema in a rollback-only owner transaction, never to
// public/application tables. Separate explicit parent approval is required.
describe.skipIf(process.env.NOTIFICATIONS_MEDIA_MIGRATION_TESTS !== "true")("0034 legacy mapping in rollback-only scratch schema", () => {
  it("preserves opt-outs, no-profile intent, tenant conflicts and legacy uncertainty", async () => {
    const url = process.env.OWNER_TEST_DATABASE_URL;
    if (!url || !/test/i.test(new URL(url).pathname)) throw new Error("Explicit disposable owner test database required");
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url });
    const client = await pool.connect();
    const schema = `notification_media_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
      await client.query(`
        CREATE TABLE users(id varchar PRIMARY KEY);
        CREATE TABLE tenant_members(tenant_id varchar, user_id varchar);
        CREATE TABLE user_profiles(tenant_id varchar, user_id varchar, daily_digest boolean, content_alerts boolean, product_updates boolean, timezone varchar);
        CREATE TABLE email_preferences(id varchar DEFAULT gen_random_uuid(), user_id varchar UNIQUE,
          marketing boolean DEFAULT true, product_updates boolean DEFAULT true, daily_digest boolean DEFAULT true,
          content_alerts boolean DEFAULT true, unsubscribed_at timestamp);
        CREATE TABLE email_deliveries(id varchar, status varchar, error_message text);
        CREATE TABLE media_assets(id varchar, tenant_id varchar, user_id varchar, storage_key text);
        INSERT INTO users VALUES ('legacy'), ('conflict'), ('no-profile'), ('global'), ('new');
        INSERT INTO tenant_members VALUES ('a','legacy'), ('a','conflict'), ('b','conflict');
        INSERT INTO user_profiles VALUES ('a','legacy',false,true,false,'Asia/Kolkata'),
          ('a','conflict',true,false,true,'America/New_York'), ('b','conflict',false,true,true,'UTC');
        INSERT INTO email_preferences(user_id, daily_digest, content_alerts, product_updates) VALUES ('conflict',true,true,false), ('no-profile',false,true,true);
        INSERT INTO email_preferences(user_id, unsubscribed_at) VALUES ('global',now());
        INSERT INTO email_deliveries VALUES ('pending','pending',NULL), ('failed','failed','legacy error'), ('sent','sent',NULL);
        INSERT INTO media_assets VALUES ('asset','a','legacy','a/legacy/asset');
      `);
      const migration = await readFile(new URL("../migrations/0034_notifications_media.sql", import.meta.url), "utf8");
      await client.query(migration);
      const result = await client.query("SELECT * FROM email_preferences ORDER BY user_id");
      const rows = Object.fromEntries(result.rows.map(row => [row.user_id, row]));
      expect(rows.legacy).toMatchObject({ daily_digest: false, content_alerts: true, product_updates: false, digest_timezone: "Asia/Kolkata" });
      expect(rows.conflict).toMatchObject({ daily_digest: false, content_alerts: false, product_updates: false, digest_timezone: "America/New_York" });
      expect(rows["no-profile"]).toMatchObject({ daily_digest: false, content_alerts: true, product_updates: true });
      expect(rows.new).toMatchObject({ daily_digest: true, content_alerts: false, digest_timezone: "UTC" });
      expect(rows.global).toMatchObject({ marketing: false, daily_digest: false, content_alerts: false, publishing: false, account_alerts: false, weekly_summary: false });
      expect((await client.query("SELECT id,status FROM email_deliveries ORDER BY id")).rows).toEqual([
        { id: "failed", status: "unknown" }, { id: "pending", status: "unknown" }, { id: "sent", status: "sent" },
      ]);
      expect((await client.query("SELECT storage_backend, storage_location, deletion_requested_at FROM media_assets")).rows[0])
        .toEqual({ storage_backend: "local", storage_location: null, deletion_requested_at: null });
    } finally {
      try { await client.query("ROLLBACK"); } finally { client.release(); await pool.end(); }
    }
  });
});