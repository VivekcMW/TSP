import { z } from "zod";

/** What subscribers agree to. Shown on the banner and stored with each sign-up. */
export const NEWSLETTER_PROMISE = "One email a month from TheSocialPundit: posting ideas that work, new features and guides. Unsubscribe any time.";

export const NEWSLETTER_SOURCES = ["landing", "newsletter-page"] as const;

export const newsletterSignup = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  source: z.enum(NEWSLETTER_SOURCES).default("landing"),
}).strict();

export const newsletterTokenBody = z.object({ token: z.string().min(10).max(200) }).strict();
