-- Team workspace invitations: invite a collaborator into an EXISTING tenant
-- with a role, distinct from the unrelated friend_invitations growth feature
-- (which creates brand new, separate accounts/tenants, never membership).
--
-- Deliberately NOT tenant-RLS, same precedent as friend_invitations (0049):
-- accepting a token must resolve the invitation's tenant before the accepting
-- user has any membership (and therefore no app.tenant_id) for that tenant.
-- Authorization is enforced entirely in server code (server/services/
-- teamInvitations.ts), which explicitly checks the caller's tenant/role
-- before any list/invite/revoke operation.

BEGIN;

CREATE TABLE IF NOT EXISTS tenant_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invited_email varchar(254) NOT NULL CHECK (
    invited_email = lower(btrim(invited_email)) AND char_length(invited_email) BETWEEN 3 AND 254
    AND invited_email !~ '[[:space:]]' AND position('@' in invited_email) > 1
  ),
  role varchar NOT NULL CHECK (role IN ('member', 'manager', 'admin')),
  invited_by_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Lowercase hex SHA-256 of a cryptographically random bearer token. The raw
  -- token is never persisted, only emailed once at invite time.
  token_hash varchar(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  accepted_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  accepted_at timestamptz,
  CONSTRAINT tenant_invitations_accepted_consistency CHECK (
    (status = 'accepted') = (accepted_at IS NOT NULL AND accepted_by_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_tenant_invitations_tenant ON tenant_invitations (tenant_id, status);
-- At most one pending invitation per (tenant, email) at a time; a revoked or
-- accepted row no longer blocks a fresh invite to the same address.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tenant_invitations_pending_email ON tenant_invitations (tenant_id, invited_email) WHERE status = 'pending';

REVOKE ALL ON tenant_invitations FROM PUBLIC, tsp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_invitations TO tsp_app;

COMMIT;
