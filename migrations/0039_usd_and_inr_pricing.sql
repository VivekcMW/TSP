-- USD pricing with an INR option for India. Amounts are in the smallest
-- currency unit (cents, paise). Razorpay plan IDs differ between test and live
-- mode, so each environment links its own; none are hardcoded here. Checkout
-- refuses a plan until its Razorpay plan matches amount, currency and period.
UPDATE billing_plans
   SET amount = 2000, currency = 'USD', interval = 'monthly', razorpay_plan_id = NULL, updated_at = now()
 WHERE key = 'pro_monthly';

INSERT INTO billing_plans (id, key, name, description, amount, currency, interval, features)
VALUES
  ('plan_pro_yearly', 'pro_yearly', 'Pro Yearly', 'Build your professional authority consistently.', 20000, 'USD', 'annual',
    '["Unlimited AI post generations", "All supported platforms", "Scheduling and publishing", "Performance insights"]'::jsonb),
  ('plan_pro_monthly_inr', 'pro_monthly_inr', 'Pro Monthly', 'Build your professional authority consistently.', 99900, 'INR', 'monthly',
    '["Unlimited AI post generations", "All supported platforms", "Scheduling and publishing", "Performance insights"]'::jsonb),
  ('plan_pro_yearly_inr', 'pro_yearly_inr', 'Pro Yearly', 'Build your professional authority consistently.', 999900, 'INR', 'annual',
    '["Unlimited AI post generations", "All supported platforms", "Scheduling and publishing", "Performance insights"]'::jsonb)
ON CONFLICT DO NOTHING;
