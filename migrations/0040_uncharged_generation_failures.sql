-- Failures before any AI work (an unreadable source, or a provider that refused the call)
-- are recorded as failed_uncharged and do not use up the generation allowance.
ALTER TABLE billing_generation_operations DROP CONSTRAINT IF EXISTS billing_generation_status_check;
ALTER TABLE billing_generation_operations ADD CONSTRAINT billing_generation_status_check
  CHECK (status IN ('started', 'succeeded', 'failed', 'failed_uncharged', 'cancelled'));
