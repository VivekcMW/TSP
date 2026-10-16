-- RESERVED exclusively for roadmap 25/26. Parent-coordinated rollout only.
-- Do not run in parallel with another migration/test agent.
ALTER TABLE email_preferences
  ADD COLUMN publishing boolean NOT NULL DEFAULT true,
  ADD COLUMN account_alerts boolean NOT NULL DEFAULT true,
  ADD COLUMN weekly_summary boolean NOT NULL DEFAULT false,
  ADD COLUMN digest_timezone varchar NOT NULL DEFAULT 'UTC',
  ADD COLUMN digest_time varchar NOT NULL DEFAULT '09:00';
ALTER TABLE email_preferences ALTER COLUMN content_alerts SET DEFAULT false;

-- FORCE RLS means a migration owner cannot assume an unscoped profile scan.
-- Aggregate each user's legacy profiles across their membership tenants with a
-- transaction-local tenant setting. False wins any ambiguous conflict: generic
-- profile updated_at is NOT evidence that a notification toggle was changed.
DO $$
DECLARE u record; membership record; p record;
  daily boolean; alerts boolean; product boolean; zone varchar; found_profile boolean;
BEGIN
  FOR u IN SELECT id FROM users ORDER BY id LOOP
    daily := true; alerts := true; product := true; zone := NULL; found_profile := false;
    FOR membership IN SELECT tenant_id FROM tenant_members WHERE user_id = u.id ORDER BY tenant_id LOOP
      PERFORM set_config('app.tenant_id', membership.tenant_id, true);
      SELECT daily_digest, content_alerts, product_updates, timezone INTO p
        FROM user_profiles WHERE user_id = u.id AND tenant_id = membership.tenant_id LIMIT 1;
      IF FOUND THEN
        found_profile := true;
        daily := daily AND p.daily_digest; alerts := alerts AND p.content_alerts; product := product AND p.product_updates;
        IF zone IS NULL AND EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p.timezone) THEN zone := p.timezone; END IF;
      END IF;
    END LOOP;
    IF NOT found_profile THEN alerts := false; END IF;
    INSERT INTO email_preferences(user_id, daily_digest, content_alerts, product_updates, digest_timezone)
      VALUES (u.id, daily, alerts, product, coalesce(zone, 'UTC'))
      ON CONFLICT (user_id) DO UPDATE SET
        daily_digest = email_preferences.daily_digest AND excluded.daily_digest,
        content_alerts = email_preferences.content_alerts AND (NOT found_profile OR excluded.content_alerts),
        product_updates = email_preferences.product_updates AND excluded.product_updates,
        digest_timezone = excluded.digest_timezone;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
-- Old marketing=false also meant global unsubscribe. Preserve that suppression
-- once, then allow explicit category opt-in without enabling sibling categories.
UPDATE email_preferences SET marketing=false, product_updates=false, daily_digest=false,
  content_alerts=false, publishing=false, account_alerts=false, weekly_summary=false
  WHERE unsubscribed_at IS NOT NULL;

ALTER TABLE email_deliveries
  ADD COLUMN claim_token varchar,
  ADD COLUMN lease_until timestamptz,
  ADD COLUMN retry_at timestamptz,
  ADD COLUMN attempts integer NOT NULL DEFAULT 0;
-- Previously pending/failed could have crossed the provider boundary. Never replay.
UPDATE email_deliveries SET status='unknown', error_message='Legacy delivery requires reconciliation'
  WHERE status IN ('pending','failed');
CREATE INDEX idx_email_delivery_recovery ON email_deliveries(status, lease_until, id);

ALTER TABLE media_assets
  ADD COLUMN storage_backend varchar NOT NULL DEFAULT 'local',
  ADD COLUMN storage_location jsonb,
  ADD COLUMN deletion_requested_at timestamptz;
ALTER TABLE media_assets ADD CONSTRAINT media_backend_check CHECK (storage_backend IN ('local','s3','r2'));
ALTER TABLE media_assets ADD CONSTRAINT media_locator_check CHECK (
  (storage_backend='local' AND storage_location IS NULL) OR
  (storage_backend IN ('s3','r2') AND storage_location IS NOT NULL AND jsonb_typeof(storage_location)='object' AND storage_key LIKE 'media:v1:%'));
CREATE INDEX idx_media_deletion_repair ON media_assets(tenant_id,user_id,id) WHERE deletion_requested_at IS NOT NULL;