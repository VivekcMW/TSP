-- Article identities are claimed with the delivery, before provider dispatch.
-- No message bodies, article URLs or credentials are persisted here.
ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS digest_context jsonb;

CREATE INDEX IF NOT EXISTS idx_email_digest_history
  ON email_deliveries (user_id, (digest_context->>'tenantId'))
  WHERE type = 'daily_digest' AND status IN ('pending', 'sending', 'sent', 'unknown');
