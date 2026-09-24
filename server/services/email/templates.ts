import { platformLabel } from "@shared/platform-labels";

/** Content of the transactional emails. The shared wrapper adds the greeting, button and footer. */
export interface EmailContent {
  subject: string;
  eyebrow: string;
  html: string;
  text?: string;
  preheader?: string;
  primaryCta?: { label: string; url: string };
  /** An outlined button beside the main one. */
  secondaryCta?: { label: string; url: string };
  /** HTML shown after the button (a sign-off or a P.S.). */
  afterCta?: string;
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

export interface ReminderStory { headline: string; source: string; url: string }
const tidyStory = (story: ReminderStory): ReminderStory => ({ ...story, headline: withoutSourceSuffix(story.headline, story.source) });

/** Opens Create with the story loaded (see client create-post-provider). */
const createFrom = (url: string) => `${appUrl()}/dashboard/create?article=${encodeURIComponent(url)}`;
const namedTail = (firstName: string | null | undefined, text: string, joiner = ", ") => firstName ? `${text}${joiner}${firstName}` : text;
const joinTopics = (topics: string[]) => topics.length > 1 ? `${topics.slice(0, -1).join(", ")} and ${topics.at(-1)}` : topics[0];
const signOff = () => `<p style="margin:0">— Pundit, at TheSocialPundit</p><p style="font-size:13px;color:#667085">Too busy this week? No problem. You can <a href="${appUrl()}/dashboard/settings?tab=notifications" style="color:#1b2a4a">pause these reminders in Settings</a> anytime.</p>`;

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
  /** Email 1: after one quiet week (also the monthly check-in). */
  reminderWeekly: ({ firstName, topics, stories, variant }: { firstName: string | null; topics: string[]; stories: ReminderStory[]; variant: 0 | 1 | 2 }): EmailContent => {
    const picked = stories.slice(0, 3).map(tidyStory);
    if (!picked.length) {
      return {
        subject: namedTail(firstName, "Give Pundit fresh topics to find you stories"),
        eyebrow: "Your weekly nudge",
        preheader: "A couple of new topics and Discover fills up again.",
        html: `<p>Discover didn't find new stories for you this week. That usually means your topics need a refresh.</p><p>Add a couple of topics or publications you care about, and Pundit starts finding stories worth writing about again.</p>`,
        primaryCta: { label: "Refresh my topics", url: `${appUrl()}/dashboard/settings?tab=content` },
        afterCta: signOff(),
      };
    }
    const count = picked.length === 1 ? "A story this week that needs your take" : `${picked.length} stories this week that need your take`;
    const subject = [namedTail(firstName, count), "Your industry kept talking this week. Your voice was missing.", "Pundit saved you a seat in this week's conversation"][variant];
    const where = topics.length ? `<strong>${escapeHtml(joinTopics(topics.slice(0, 2)))}</strong>` : "your industry";
    return {
      subject,
      eyebrow: "Your weekly nudge",
      preheader: "Pick one and we'll draft it in your voice in under a minute.",
      html: `<p>Quiet week on your feeds, busy week in ${where}. ${picked.length === 1 ? "One story" : `${picked.length === 3 ? "Three" : "Two"} stories`} picked up while you were heads-down:</p>${picked.map(story => `<div style="border-top:1px solid #e4e7ec;padding:14px 0"><p style="margin:0 0 4px;font-weight:700;color:#1b2a4a">${escapeHtml(story.headline)}</p><p style="margin:0;font-size:13px;color:#667085">${escapeHtml(story.source)} · <a href="${escapeHtml(createFrom(story.url))}" style="color:#1b2a4a;font-weight:700">Write about this →</a></p></div>`).join("")}<p>One thoughtful post a week keeps you in the conversation your peers are having. Pick one, and Pundit drafts it in your voice. You just add your take.</p>`,
      text: [`Quiet week on your feeds, busy week in ${topics.length ? joinTopics(topics.slice(0, 2)) : "your industry"}. These stories picked up while you were heads-down:`,
        ...picked.map(story => `${story.headline} (${story.source})\nWrite about this: ${createFrom(story.url)}`),
        "One thoughtful post a week keeps you in the conversation your peers are having. Pick one, and Pundit drafts it in your voice. You just add your take."].join("\n\n"),
      primaryCta: { label: "Write my post", url: createFrom(picked[0].url) },
      afterCta: signOff(),
    };
  },
  /** Email 2: after two quiet weeks: one story, sixty seconds. */
  reminderSingle: ({ story: raw, platform }: { story: ReminderStory | null; platform: string }): EmailContent => {
    const story = raw && tidyStory(raw);
    return {
      subject: "The easiest post you'll write this month",
      eyebrow: "Your weekly nudge",
      preheader: "One story, one opinion, sixty seconds.",
      html: story
        ? `<p>One story from your Discover stood out this week:</p><p style="margin:0 0 4px;font-weight:700;color:#1b2a4a">${escapeHtml(story.headline)}</p><p style="margin:0 0 16px;font-size:13px;color:#667085">${escapeHtml(story.source)}</p><p>You already have an opinion on this. Give Pundit sixty seconds and it becomes a ${escapeHtml(platformLabel(platform))} post in your voice. Edit it, or post it as is.</p>`
        : `<p>Pick any story from your Discover. Give Pundit sixty seconds and it becomes a ${escapeHtml(platformLabel(platform))} post in your voice. Edit it, or post it as is.</p>`,
      primaryCta: story ? { label: "Turn this into a post", url: createFrom(story.url) } : { label: "Open Discover", url: `${appUrl()}/dashboard/discover` },
      afterCta: signOff(),
    };
  },
  /** Email 3: the last in the series asks before sending more. */
  reminderCheckIn: ({ firstName }: { firstName: string | null }): EmailContent => ({
    subject: namedTail(firstName, "Should we keep sending these", ", ") + "?",
    eyebrow: "Your weekly nudge",
    preheader: "We'll pause reminders if now isn't the right time.",
    html: `<p>We don't want to crowd your inbox. If now isn't the right time, we'll pause the reminders. Your setup and Discover stay ready, and your topics keep updating in the background.</p>`,
    primaryCta: { label: "Keep me posting", url: `${appUrl()}/dashboard/discover` },
    secondaryCta: { label: "Pause for a month", url: `${appUrl()}/dashboard/settings?tab=notifications&pause=reminders` },
  }),
  productUpdate: (title: string, body: string, url: string): EmailContent => ({
    subject: title, eyebrow: "Product update", html: `<p>${escapeHtml(body)}</p>`, primaryCta: { label: "Explore the update", url },
  }),
};
