-- Retire country-specific INR checkout. Existing subscriptions keep their plan
-- references, while all new purchases use the global USD catalog.
UPDATE billing_plans
   SET listed = false, is_active = false, updated_at = now()
 WHERE currency = 'INR' AND amount > 0;

UPDATE billing_plans
   SET listed = true, updated_at = now()
 WHERE currency = 'USD' AND amount > 0;
