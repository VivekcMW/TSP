import { randomUUID } from "node:crypto";
import pg from "pg";
import { hashPassword } from "better-auth/crypto";

const databaseUrl = process.env.OWNER_DATABASE_URL;
const email = process.env.LIVE_ACCEPTANCE_EMAIL?.trim().toLowerCase();
const password = process.env.LIVE_ACCEPTANCE_PASSWORD;

if (!databaseUrl) throw new Error("OWNER_DATABASE_URL is required.");
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error("LIVE_ACCEPTANCE_EMAIL must be a valid email address.");
}
if (!password || password.length < 16 || /[\r\n]/.test(password)) {
  throw new Error("LIVE_ACCEPTANCE_PASSWORD must be at least 16 characters and contain no newlines.");
}

const { Client } = pg;
const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });
await client.connect();

try {
  await client.query("begin");
  const passwordHash = await hashPassword(password);
  const userResult = await client.query<{ id: string }>(
    `insert into users (
       id, email, first_name, last_name, name, email_verified,
       country, industry, countries, industries, registration_completed
     ) values (
       $1, $2, 'Live', 'Acceptance', 'Live Acceptance', true,
       'India', 'technology-saas', '["India"]'::jsonb,
       '["technology-saas"]'::jsonb, now()
     )
     on conflict (email) do update set
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       name = excluded.name,
       email_verified = true,
       country = excluded.country,
       industry = excluded.industry,
       countries = excluded.countries,
       industries = excluded.industries,
       registration_completed = coalesce(users.registration_completed, now()),
       updated_at = now()
     returning id`,
    [randomUUID(), email],
  );
  const userId = userResult.rows[0]?.id;
  if (!userId) throw new Error("Could not provision the live-acceptance user.");

  await client.query(
    `insert into accounts (
       id, account_id, provider_id, user_id, password, created_at, updated_at
     ) values ($1, $2, 'credential', $2, $3, now(), now())
     on conflict (provider_id, account_id) do update set
       user_id = excluded.user_id,
       password = excluded.password,
       updated_at = now()`,
    [randomUUID(), userId, passwordHash],
  );

  let tenant = await client.query<{ id: string }>(
    `select t.id
       from tenant_members tm
       join tenants t on t.id = tm.tenant_id
      where tm.user_id = $1 and t.kind = 'personal'
      order by tm.created_at, t.id
      limit 1`,
    [userId],
  );
  if (!tenant.rows[0]) {
    tenant = await client.query<{ id: string }>(
      `insert into tenants (id, kind, name, status)
       values ($1, 'personal', 'Live Acceptance', 'active')
       returning id`,
      [randomUUID()],
    );
    await client.query(
      `insert into tenant_members (tenant_id, user_id, role)
       values ($1, $2, 'owner')`,
      [tenant.rows[0].id, userId],
    );
  }

  const tenantId = tenant.rows[0]?.id;
  if (!tenantId) throw new Error("Could not provision the live-acceptance tenant.");
  await client.query(
    `insert into user_profiles (
       id, tenant_id, user_id, focus_description, onboarding_status,
       keywords, publications, influencers, companies, enabled_platforms
     ) values (
       $1, $2, $3,
       'Live acceptance coverage for technology and SaaS workflows.',
       'completed', '[{"keyword":"artificial intelligence","weight":1}]'::jsonb,
       '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["linkedin"]'::jsonb
     )
     on conflict (tenant_id, user_id) do update set
       onboarding_status = 'completed',
       focus_description = excluded.focus_description,
       updated_at = now()`,
    [randomUUID(), tenantId, userId],
  );

  await client.query("delete from sessions where user_id = $1", [userId]);
  await client.query("commit");
  console.log("Provisioned the dedicated live-acceptance account.");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
