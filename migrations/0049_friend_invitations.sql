-- Private, service-managed invitation storage, like newsletter_subscribers (0044).
-- Deliberately NOT tenant/app.user_id RLS: quotas, recipient cooldowns, dispatch
-- and bearer-token opt-outs must see all inviters, including without a session.
-- Only trusted server code connects as tsp_app. Request-facing access MUST go
-- through invitations-store with the authenticated userId, never a body userId.
-- No public listing or generic table endpoint is permitted. Internal cross-user
-- operations return only an eligibility boolean, a count or a generic outcome;
-- audit by invitation/request ID, never email, IP, token or suppression reason.
CREATE TABLE IF NOT EXISTS friend_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Preserve global cooldown/IP budgets after account deletion, but disallow
  -- dispatch when the inviter is gone. All rows are pruned after 90 days.
  user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  email varchar(254) NOT NULL CHECK (
    email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254
    AND email !~ '[[:space:]]' AND position('@' in email) > 1
  ),
  email_hash varchar(64) NOT NULL CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  first_name varchar(100) CHECK (first_name IS NULL OR char_length(btrim(first_name)) > 0),
  inviter_name varchar(200) NOT NULL CHECK (char_length(btrim(inviter_name)) > 0),
  -- Caller supplies HMAC-SHA256(IP, server secret) and SHA256(random token),
  -- lowercase hex. Never persist raw IPs or bearer tokens.
  ip_hash varchar(64) NOT NULL CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  token_hash varchar(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  -- Reservation state only; email_deliveries owns sending/retry/delivery state.
  status varchar(20) NOT NULL DEFAULT 'reserved' CHECK (status = 'reserved'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT friend_invitations_sender_request_unique UNIQUE (user_id, request_id)
);

CREATE INDEX IF NOT EXISTS friend_invitations_sender_created_idx ON friend_invitations (user_id, created_at);
CREATE INDEX IF NOT EXISTS friend_invitations_ip_created_idx ON friend_invitations (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS friend_invitations_recipient_created_idx ON friend_invitations (email_hash, created_at);
CREATE INDEX IF NOT EXISTS friend_invitations_created_idx ON friend_invitations (created_at);

-- Global permanent invitation opt-out. No FK: deleting/pruning invitations or
-- accounts must NEVER remove this record. Hashes are pseudonymous, not secrets;
-- keep access restricted even though no raw recipient address is stored here.
CREATE TABLE IF NOT EXISTS friend_invitation_suppressions (
  email_hash varchar(64) PRIMARY KEY CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Revoke broad default privileges from 0002 before granting the minimum needed.
REVOKE ALL ON friend_invitations, friend_invitation_suppressions FROM PUBLIC, tsp_app;
GRANT SELECT, INSERT, DELETE ON friend_invitations TO tsp_app;
GRANT SELECT, INSERT ON friend_invitation_suppressions TO tsp_app;