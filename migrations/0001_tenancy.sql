-- Wave 1: tenancy, roles and audit.
--
-- tenant_id is introduced pre-launch, at effectively zero rows, deliberately:
-- retrofitting it across ~1B inbox_items and 7.3B social_analytics rows would
-- be a multi-week, high-risk migration.
--
-- Add-nullable -> backfill -> constrain, so this pattern still holds when the
-- tables are not empty.

BEGIN;

-- 1. tenancy tables ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants (
  id           varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         varchar NOT NULL DEFAULT 'personal',
  name         varchar NOT NULL,
  clerk_org_id varchar UNIQUE,
  status       varchar NOT NULL DEFAULT 'active',
  created_at   timestamp NOT NULL DEFAULT now(),
  updated_at   timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants (status);

CREATE TABLE IF NOT EXISTS tenant_members (
  tenant_id  varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       varchar NOT NULL DEFAULT 'member',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tenant_members_user ON tenant_members (user_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id                  varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id       varchar REFERENCES users(id) ON DELETE SET NULL,
  actor_platform_role varchar,
  tenant_id           varchar REFERENCES tenants(id) ON DELETE SET NULL,
  action              varchar NOT NULL,
  resource_type       varchar,
  resource_id         varchar,
  justification       text,
  correlation_id      varchar,
  metadata            jsonb,
  created_at          timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_log (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor_created  ON audit_log (actor_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action         ON audit_log (action);

-- 2. platform staff role ----------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_role varchar;

-- 3. tenant_id, nullable for now --------------------------------------------

ALTER TABLE user_profiles    ADD COLUMN IF NOT EXISTS tenant_id varchar;
ALTER TABLE inbox_items      ADD COLUMN IF NOT EXISTS tenant_id varchar;
ALTER TABLE drafts           ADD COLUMN IF NOT EXISTS tenant_id varchar;
ALTER TABLE social_accounts  ADD COLUMN IF NOT EXISTS tenant_id varchar;
ALTER TABLE social_analytics ADD COLUMN IF NOT EXISTS tenant_id varchar;
ALTER TABLE engine_run_logs  ADD COLUMN IF NOT EXISTS tenant_id varchar;

-- 4. backfill: one personal tenant per existing user, owned by them ---------

INSERT INTO tenants (id, kind, name, status)
SELECT gen_random_uuid(), 'personal',
       COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email),
       'active'
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_members tm
  JOIN tenants t ON t.id = tm.tenant_id AND t.kind = 'personal'
  WHERE tm.user_id = u.id
);

-- Pair each new tenant with its user. Both sets are ordered identically, so
-- row_number() lines them up deterministically.
WITH unowned AS (
  SELECT t.id, row_number() OVER (ORDER BY t.created_at, t.id) AS rn
  FROM tenants t
  WHERE t.kind = 'personal'
    AND NOT EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.tenant_id = t.id)
), unassigned AS (
  SELECT u.id, row_number() OVER (ORDER BY u.created_at, u.id) AS rn
  FROM users u
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant_members tm
    JOIN tenants t ON t.id = tm.tenant_id AND t.kind = 'personal'
    WHERE tm.user_id = u.id
  )
)
INSERT INTO tenant_members (tenant_id, user_id, role)
SELECT o.id, a.id, 'owner' FROM unowned o JOIN unassigned a ON a.rn = o.rn;

-- Stamp every existing row with its owner's personal tenant.
UPDATE user_profiles    d SET tenant_id = tm.tenant_id FROM tenant_members tm JOIN tenants t ON t.id = tm.tenant_id AND t.kind='personal' WHERE tm.user_id = d.user_id AND d.tenant_id IS NULL;
UPDATE inbox_items      d SET tenant_id = tm.tenant_id FROM tenant_members tm JOIN tenants t ON t.id = tm.tenant_id AND t.kind='personal' WHERE tm.user_id = d.user_id AND d.tenant_id IS NULL;
UPDATE drafts           d SET tenant_id = tm.tenant_id FROM tenant_members tm JOIN tenants t ON t.id = tm.tenant_id AND t.kind='personal' WHERE tm.user_id = d.user_id AND d.tenant_id IS NULL;
UPDATE social_accounts  d SET tenant_id = tm.tenant_id FROM tenant_members tm JOIN tenants t ON t.id = tm.tenant_id AND t.kind='personal' WHERE tm.user_id = d.user_id AND d.tenant_id IS NULL;
UPDATE social_analytics d SET tenant_id = tm.tenant_id FROM tenant_members tm JOIN tenants t ON t.id = tm.tenant_id AND t.kind='personal' WHERE tm.user_id = d.user_id AND d.tenant_id IS NULL;
UPDATE engine_run_logs  d SET tenant_id = tm.tenant_id FROM tenant_members tm JOIN tenants t ON t.id = tm.tenant_id AND t.kind='personal' WHERE tm.user_id = d.user_id AND d.tenant_id IS NULL;

-- 5. constrain --------------------------------------------------------------

ALTER TABLE user_profiles    ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE inbox_items      ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE drafts           ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE social_accounts  ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE social_analytics ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE engine_run_logs  ALTER COLUMN tenant_id SET NOT NULL;

-- 6. a profile is now per (tenant, user), not per user ----------------------

ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_user_id_unique;
-- 0000 already declares this constraint inline for a fresh database, so the
-- duplicate is expected here and must not abort the migration.
DO $$ BEGIN
  ALTER TABLE user_profiles ADD CONSTRAINT uniq_user_profiles_tenant_user UNIQUE (tenant_id, user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

-- 7. tenant-scoped indexes --------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_user_profiles_tenant              ON user_profiles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_inbox_tenant_status               ON inbox_items (tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_drafts_tenant_status              ON drafts (tenant_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_social_accounts_tenant            ON social_accounts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_social_analytics_tenant_provider  ON social_analytics (tenant_id, provider, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_engine_runs_tenant                ON engine_run_logs (tenant_id);

COMMIT;
