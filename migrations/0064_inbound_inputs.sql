-- Phase 6 external inputs: private newsletter forwarding addresses, the
-- newsletters received through them, and personal capture tokens for the
-- browser extension and bookmarklet. Additive only.
--
-- Bearer secrets are never stored in plain text. token_hash is the lowercase
-- hex SHA-256 of a random token, as in the invitation tables (0049, 0050).
-- inbound_addresses.token_encrypted also keeps an AES-GCM envelope made by
-- server/services/webhookSecrets.ts so the owner can see the address again.
--
-- The email webhook and the capture endpoint must resolve a token before any
-- tenant is known. The invitation tables solve that by opting out of RLS. Here
-- the tables keep FORCE ROW LEVEL SECURITY with the usual tenant policy, plus
-- one SELECT-only policy per token table that matches only the row whose
-- token_hash equals a transaction-local setting. Computing the hash requires
-- the token, so that lookup can never list or reach any other row. There is no
-- SECURITY DEFINER function: none exist in this schema, and FORCE RLS binds
-- the table owner too, so its behaviour would differ between environments.

CREATE TABLE IF NOT EXISTS inbound_addresses (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL CONSTRAINT inbound_addresses_token_hash_key UNIQUE
    CONSTRAINT inbound_addresses_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  token_hint varchar(8) NOT NULL CONSTRAINT inbound_addresses_token_hint_format CHECK (token_hint ~ '^[a-z0-9]{4}$'),
  token_encrypted text CONSTRAINT inbound_addresses_token_encrypted_format CHECK (token_encrypted IS NULL OR token_encrypted LIKE 'enc:%'),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  disabled boolean NOT NULL DEFAULT false,
  CONSTRAINT inbound_addresses_tenant_user_key UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS inbound_messages (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id varchar(500) NOT NULL CONSTRAINT inbound_messages_message_id_length CHECK (char_length(btrim(message_id)) > 0),
  from_address varchar(320),
  from_name varchar(200),
  subject varchar(500),
  received_at timestamptz NOT NULL DEFAULT now(),
  links_found integer NOT NULL DEFAULT 0 CONSTRAINT inbound_messages_links_found_range CHECK (links_found BETWEEN 0 AND 1000),
  items_created integer NOT NULL DEFAULT 0 CONSTRAINT inbound_messages_items_created_range CHECK (items_created BETWEEN 0 AND links_found),
  status varchar(20) NOT NULL DEFAULT 'processing'
    CONSTRAINT inbound_messages_status_values CHECK (status IN ('processing', 'processed', 'confirmation')),
  CONSTRAINT inbound_messages_tenant_user_message_key UNIQUE (tenant_id, user_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_inbound_messages_tenant_user_received ON inbound_messages (tenant_id, user_id, received_at DESC);

CREATE TABLE IF NOT EXISTS capture_tokens (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL CONSTRAINT capture_tokens_token_hash_key UNIQUE
    CONSTRAINT capture_tokens_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  token_hint varchar(8) NOT NULL CONSTRAINT capture_tokens_token_hint_format CHECK (token_hint ~ '^[A-Za-z0-9_-]{4}$'),
  label varchar(60) NOT NULL CONSTRAINT capture_tokens_label_length CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_capture_tokens_tenant_user_created ON capture_tokens (tenant_id, user_id, created_at DESC);

ALTER TABLE inbound_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_addresses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inbound_addresses;
CREATE POLICY tenant_isolation ON inbound_addresses
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS inbound_address_token_lookup ON inbound_addresses;
CREATE POLICY inbound_address_token_lookup ON inbound_addresses FOR SELECT
  USING (NOT disabled AND token_hash = current_setting('app.inbound_token_hash', true));

ALTER TABLE inbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inbound_messages;
CREATE POLICY tenant_isolation ON inbound_messages
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE capture_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON capture_tokens;
CREATE POLICY tenant_isolation ON capture_tokens
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS capture_token_lookup ON capture_tokens;
CREATE POLICY capture_token_lookup ON capture_tokens FOR SELECT
  USING (revoked_at IS NULL AND token_hash = current_setting('app.capture_token_hash', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON inbound_addresses, inbound_messages, capture_tokens TO tsp_app;
