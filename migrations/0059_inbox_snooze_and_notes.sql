-- Inbox snooze and private user notes. Additive only.
-- snoozed_until hides an active story from For you until that time and keeps
-- auto-refresh from replacing it; NULL means not snoozed. user_notes holds
-- short private notes owned by one tenant member.
ALTER TABLE inbox_items ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;
CREATE INDEX IF NOT EXISTS idx_inbox_snoozed_until ON inbox_items (tenant_id, user_id, snoozed_until)
  WHERE snoozed_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_notes (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text text NOT NULL CONSTRAINT user_notes_text_length CHECK (char_length(btrim(text)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_notes_tenant_user_created ON user_notes (tenant_id, user_id, created_at DESC);

ALTER TABLE user_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_notes;
CREATE POLICY tenant_isolation ON user_notes
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON user_notes TO tsp_app;
