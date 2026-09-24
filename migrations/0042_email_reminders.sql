-- Weekly "we miss you" reminders after a quiet week: their own opt-out (on by default)
-- and a pause date ("Pause for a month"). Unsubscribe-all still stops them.
ALTER TABLE email_preferences ADD COLUMN IF NOT EXISTS reminders boolean NOT NULL DEFAULT true;
ALTER TABLE email_preferences ADD COLUMN IF NOT EXISTS reminders_paused_until timestamp;
