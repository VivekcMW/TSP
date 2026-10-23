import type { Express } from "express";
import { newsletterSignup, newsletterTokenBody } from "@shared/newsletter";
import { deliverAppEmail, emailTemplates } from "../services/email";
import { confirmSubscription, confirmUrl, markConfirmationSent, requestSubscription, unsubscribe } from "../services/newsletter";
import { newsletterSignupRateLimit } from "../middlewares/rateLimit";

// The same answer for every valid address, so the endpoint can't reveal who is subscribed.
const CHECK_INBOX = { message: "Check your inbox and click the link to confirm your subscription." };

export function registerNewsletterRoutes(app: Express) {
  app.post("/api/public/newsletter", newsletterSignupRateLimit, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = newsletterSignup.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Enter a valid email address." });
    try {
      const { email, source } = parsed.data;
      const request = await requestSubscription(email, source);
      if (request.send) {
        await deliverAppEmail({
          type: "newsletter_confirmation", recipient: email, required: true,
          dedupeKey: `newsletter-confirm:${request.id}:${request.nonce}`,
          ...emailTemplates.newsletterConfirmation(confirmUrl(request.id, request.nonce)),
        });
        await markConfirmationSent(request.id);
      }
      res.status(202).json(CHECK_INBOX);
    } catch {
      res.status(503).json({ message: "We couldn't sign you up just now. Please try again in a few minutes." });
    }
  });

  for (const [action, run, done] of [["confirm", confirmSubscription, "confirmed"], ["unsubscribe", unsubscribe, "unsubscribed"]] as const) {
    app.post(`/api/public/newsletter/${action}`, async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const parsed = newsletterTokenBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "This link is invalid or has expired." });
      try {
        const outcome = await run(parsed.data.token);
        if (outcome !== done) return res.status(400).json({ message: "This link is invalid or has expired." });
        res.json({ status: outcome });
      } catch {
        res.status(503).json({ message: "Something went wrong. Please try the link again in a few minutes." });
      }
    });
  }
}
