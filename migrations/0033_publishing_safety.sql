-- Parent-coordinated application ONLY. No inference of legacy live delivery.
ALTER TABLE drafts ADD COLUMN publish_approval_hash varchar;
ALTER TABLE drafts ADD COLUMN publish_approved_at timestamp;
ALTER TABLE drafts ADD COLUMN publish_approved_by varchar;
ALTER TABLE draft_schedule_targets ADD COLUMN execution_mode varchar;
ALTER TABLE draft_schedule_targets ADD COLUMN intent varchar NOT NULL DEFAULT 'schedule';
ALTER TABLE draft_schedule_targets ADD COLUMN claim_token varchar;
ALTER TABLE draft_schedule_targets ADD COLUMN revision integer NOT NULL DEFAULT 0;
ALTER TABLE draft_schedule_targets ADD COLUMN receipt_kind varchar;
ALTER TABLE draft_schedule_targets ADD COLUMN provider_post_id varchar;
ALTER TABLE draft_schedule_targets ADD CONSTRAINT publish_target_mode CHECK (execution_mode IS NULL OR execution_mode IN ('live','sandbox','dry-run'));
ALTER TABLE draft_schedule_targets ADD CONSTRAINT publish_target_intent CHECK (intent IN ('publish','schedule'));
ALTER TABLE draft_schedule_targets ADD CONSTRAINT publish_target_revision CHECK (revision >= 0);
ALTER TABLE publish_job_logs ADD COLUMN target_id varchar;
ALTER TABLE publish_job_logs ADD COLUMN claim_token varchar;
ALTER TABLE publish_job_logs ADD COLUMN execution_mode varchar;
ALTER TABLE publish_job_logs ADD COLUMN receipt_kind varchar;
ALTER TABLE publish_job_logs ADD COLUMN actor_user_id varchar;
ALTER TABLE publish_job_logs ADD COLUMN evidence jsonb;
ALTER TABLE publish_job_logs ADD CONSTRAINT publish_evidence_bounded CHECK (evidence IS NULL OR (jsonb_typeof(evidence) = 'object' AND octet_length(evidence::text) <= 8192));
-- Existing FORCE RLS policies on these three tables remain unchanged.
INSERT INTO platform_integrations (key,label,enabled,notes)
VALUES ('slack','Slack',false,'Incoming webhook: text only; no provider post receipt')
ON CONFLICT (key) DO NOTHING;