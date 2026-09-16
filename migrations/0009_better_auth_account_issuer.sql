-- 0009: Better Auth account identities require an issuer namespace.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS issuer varchar NOT NULL DEFAULT '';
