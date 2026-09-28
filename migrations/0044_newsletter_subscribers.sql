-- Public newsletter sign-ups (people who may not have an account). Double opt-in:
-- a row stays pending until the emailed link is confirmed. Links are HMAC-signed with
-- token_nonce, so rotating the nonce invalidates every earlier link for that address.
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(254) NOT NULL UNIQUE CHECK (email = lower(email)),
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'unsubscribed')),
  token_nonce varchar(64) NOT NULL,
  source varchar(40) NOT NULL,
  consent_text text NOT NULL,
  requested_at timestamp NOT NULL DEFAULT now(),
  confirmation_sent_at timestamp,
  confirmed_at timestamp,
  unsubscribed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS newsletter_subscribers_status_idx ON newsletter_subscribers (status);

GRANT SELECT, INSERT, UPDATE ON newsletter_subscribers TO tsp_app;
