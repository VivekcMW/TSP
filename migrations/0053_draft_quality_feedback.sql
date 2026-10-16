-- Privacy-safe model evaluation signals. This table stores event metadata and
-- edit ratios only; it never duplicates draft text or creates training consent.
CREATE TABLE IF NOT EXISTS draft_feedback_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL,
  user_id varchar NOT NULL,
  draft_id varchar NOT NULL,
  event_type varchar NOT NULL CHECK (event_type IN ('edited', 'approved_for_publishing')),
  previous_length integer,
  new_length integer,
  change_ratio numeric(5,4) CHECK (change_ratio IS NULL OR (change_ratio >= 0 AND change_ratio <= 1)),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draft_feedback_tenant_created
  ON draft_feedback_events (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_draft_feedback_draft
  ON draft_feedback_events (tenant_id, draft_id);

ALTER TABLE draft_feedback_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS draft_feedback_owner ON draft_feedback_events;
CREATE POLICY draft_feedback_owner ON draft_feedback_events
  USING (
    tenant_id = current_setting('app.tenant_id', true)
    AND user_id = current_setting('app.user_id', true)
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)
    AND user_id = current_setting('app.user_id', true)
  );
