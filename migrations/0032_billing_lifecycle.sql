-- Roadmap 24. Reserved for parent rollout; do not apply in parallel agent work.
BEGIN;
ALTER TABLE subscriptions
  ADD COLUMN razorpay_order_id varchar UNIQUE,
  ADD COLUMN checkout_amount integer,
  ADD COLUMN checkout_currency varchar,
  ADD COLUMN checkout_interval varchar,
  ADD COLUMN checkout_provider_plan_id varchar,
  ADD COLUMN checkout_provider_customer_id varchar;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_checkout_amount_check
  CHECK (checkout_amount IS NULL OR checkout_amount > 0);
-- Legacy rows are intentionally not inferred/backfilled from mutable provider notes.
-- Reconcile historical provider bindings explicitly before accepting their payments.
COMMIT;