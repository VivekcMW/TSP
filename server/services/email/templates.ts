import { platformLabel } from "@shared/platform-labels";

/** Content of the transactional emails. The shared wrapper adds the greeting, button and footer. */
export interface EmailContent {
  subject: string;
  eyebrow: string;
  html: string;
  text?: string;
  preheader?: string;
  primaryCta?: { label: string; url: string };
}

const appUrl = () => process.env.APP_URL ?? "https://www.thesocialpundit.com";

export function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

/** Unambiguous everywhere (25 October 2026), in UTC so it matches the provider's date. */
const longDate = (date: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);

const money = (amountMinor: number, currency: string) =>
  new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency }).format(amountMinor / 100);

/** Google News titles end in " - Source"; the digest already shows the source above the headline. */
const withoutSourceSuffix = (headline: string, source: string) => {
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return headline.replace(new RegExp(`\\s+[-–—|]\\s+${escaped}\\s*$`, "i"), "").replace(/[\s,;:]+$/, "").trim() || headline;
};

export const emailTemplates = {
  welcome: (industryName: string | null | undefined): EmailContent => ({
    subject: industryName ? `Welcome to TheSocialPundit · ${industryName}` : "Welcome to TheSocialPundit",
    eyebrow: "Welcome",
    preheader: "Your workspace is ready. Pundit will set up your Discover feed in about a minute.",
    html: `<p>Your workspace${industryName ? ` for <strong>${escapeHtml(industryName)}</strong>` : ""} is ready.</p><p>Tell Pundit, your setup agent, what you do. It picks the sources, topics and people to follow from today's news, so Discover fills with stories worth writing about. It takes about a minute.</p>`,
    primaryCta: { label: "Continue your setup", url: `${appUrl()}/onboarding` },
  }),
  passwordChanged: (): EmailContent => ({
    subject: "Your TheSocialPundit password was changed",
    eyebrow: "Account security",
    html: `<p>The password for your TheSocialPundit account was just changed.</p><p>If you didn't make this change, reset your password straight away from the sign-in page and contact us at hello@thesocialpundit.com.</p>`,
    primaryCta: { label: "Go to sign in", url: `${appUrl()}/sign-in` },
  }),
  paymentSucceeded: (payment: { planName: string; amountMinor: number; currency: string; paymentId: string; paidAt: Date | null }): EmailContent => ({
    subject: "Payment received — TheSocialPundit",
    eyebrow: "Payment receipt",
    html: `<p>Thank you. We received your payment for <strong>${escapeHtml(payment.planName)}</strong>.</p><p>Amount: <strong>${escapeHtml(money(payment.amountMinor, payment.currency))}</strong><br>Payment ID: ${escapeHtml(payment.paymentId)}${payment.paidAt ? `<br>Date: ${longDate(payment.paidAt)}` : ""}</p><p>Keep this email for your records.</p>`,
    primaryCta: { label: "View billing", url: `${appUrl()}/dashboard/settings?tab=billing` },
  }),
  paymentFailed: (reason: string): EmailContent => ({
    subject: "Action needed: payment failed",
    eyebrow: "Payment update",
    html: `<p>We couldn't complete your payment.</p><p>${escapeHtml(reason)}</p><p>Please review your billing details and try again.</p>`,
    primaryCta: { label: "Review billing", url: `${appUrl()}/dashboard/settings?tab=billing` },
  }),
  subscriptionCancelled: (endsAt: Date | null): EmailContent => ({
    subject: "Your subscription will end — TheSocialPundit",
    eyebrow: "Subscription update",
    html: `<p>Your subscription is cancelled and won't renew. You keep full access until <strong>${endsAt ? longDate(endsAt) : "the end of your current billing period"}</strong>.</p><p>Changed your mind? You can subscribe again anytime from Billing.</p>`,
    primaryCta: { label: "View billing", url: `${appUrl()}/dashboard/settings?tab=billing` },
  }),
  postPublished: (platform: string): EmailContent => ({
    subject: `Published to ${platformLabel(platform)}`,
    eyebrow: "Publishing update",
    html: `<p>Your post was published to <strong>${escapeHtml(platformLabel(platform))}</strong>.</p>`,
    primaryCta: { label: "View published posts", url: `${appUrl()}/dashboard/content?view=published` },
  }),
  postFailed: (platform: string, reason: string): EmailContent => ({
    subject: `Publishing failed on ${platformLabel(platform)}`,
    eyebrow: "Publishing update",
    html: `<p>We couldn't publish your post to <strong>${escapeHtml(platformLabel(platform))}</strong>.</p><p>${escapeHtml(reason)}</p><p>Your draft is safe in Content, where you can fix it and try again.</p>`,
    primaryCta: { label: "Open Content", url: `${appUrl()}/dashboard/content` },
  }),
  dailyDigest: (articles: Array<{ source: string; headline: string; summary: string; url: string }>): EmailContent => {
    const picked = articles.slice(0, 5).map(article => ({ ...article, headline: withoutSourceSuffix(article.headline, article.source) }));
    return {
      subject: "Your daily industry briefing",
      eyebrow: "Daily digest",
      preheader: picked[0]?.headline,
      html: `<p>Your top stories today, picked from the topics, companies and people you follow.</p>${picked.map(article => `<article style="border-top:1px solid #e4e7ec;padding:16px 0"><p style="margin:0;color:#667085;font-size:11px;text-transform:uppercase">${escapeHtml(article.source)}</p><h2 style="font-size:18px;margin:7px 0"><a href="${escapeHtml(article.url)}" style="color:#1b2a4a;text-decoration:none">${escapeHtml(article.headline)}</a></h2>${article.summary ? `<p style="color:#667085;line-height:1.5;margin:0">${escapeHtml(article.summary)}</p>` : ""}</article>`).join("")}`,
      text: ["Your top stories today, picked from the topics, companies and people you follow.",
        ...picked.map(article => `${article.source}: ${article.headline}\n${article.url}${article.summary ? `\n${article.summary}` : ""}`)].join("\n\n"),
      primaryCta: { label: "Open Discover", url: `${appUrl()}/dashboard/discover` },
    };
  },
  productUpdate: (title: string, body: string, url: string): EmailContent => ({
    subject: title, eyebrow: "Product update", html: `<p>${escapeHtml(body)}</p>`, primaryCta: { label: "Explore the update", url },
  }),
};
