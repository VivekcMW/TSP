-- Separates "shown on the pricing page" from "can be bought now" (is_active). US dollar
-- plans stay listed while inactive until Razorpay International Payments is enabled;
-- a retired plan can be unlisted without deleting the row its subscriptions reference.
ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS listed boolean NOT NULL DEFAULT true;
