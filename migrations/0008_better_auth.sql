-- 0008: Replace Clerk identity with Better Auth while preserving existing user ids.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS name varchar NOT NULL DEFAULT '';
UPDATE users
SET name = COALESCE(NULLIF(trim(concat_ws(' ', first_name, last_name)), ''), email)
WHERE name IS NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id varchar PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token varchar NOT NULL UNIQUE,
  expires_at timestamp NOT NULL,
  ip_address varchar,
  user_agent varchar,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id varchar PRIMARY KEY,
  account_id varchar NOT NULL,
  provider_id varchar NOT NULL,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamp,
  refresh_token_expires_at timestamp,
  scope varchar,
  password varchar,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (provider_id, account_id)
);

CREATE TABLE IF NOT EXISTS verifications (
  id varchar PRIMARY KEY,
  identifier varchar NOT NULL,
  value varchar NOT NULL,
  expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_verifications_identifier ON verifications(identifier);
