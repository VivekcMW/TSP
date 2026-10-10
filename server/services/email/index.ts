import { Resend } from "resend";
import { emailColor, emailTemplates, escapeHtml } from "./templates";
import Bull from "bull";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getEmailPreferences } from "./preferences";
import { isEssentialEmail, preferenceEnabled } from "./policy";
import { beginDelivery, claimDelivery, deliveryKey, finishDelivery, recoverEmailDeliveries } from "./delivery-store";
import { queuePrefix } from "../../lib/redis-options";

export type EmailType =
  | "verification" | "password_reset" | "existing_account" | "welcome" | "password_changed"
  | "payment_succeeded" | "payment_failed" | "subscription_cancelled"
  | "draft_generated" | "draft_failed" | "post_scheduled"
  | "post_published" | "post_failed" | "daily_digest" | "content_alert"
  | "oauth_connected" | "token_expired" | "weekly_summary"
  | "usage_warning" | "product_update" | "maintenance" | "incident" | "re_engagement" | "newsletter_confirmation" | "friend_invitation" | "team_invitation";

export interface AppEmail {
  type: EmailType;
  recipient: string;
  recipientName?: string;
  userId?: string;
  subject: string;
  html: string;
  text?: string;
  dedupeKey?: string;
  invitationId?: string;
  invitationUnsubscribeUrl?: string;
  required?: boolean;
  eyebrow?: string;
  preheader?: string;
  primaryCta?: { label: string; url: string };
  secondaryCta?: { label: string; url: string };
  afterCta?: string;
}

const FROM_NAME = "TheSocialPundit";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL?.trim() || "hello@thesocialpundit.com";
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
let emailQueue: Bull.Queue<AppEmail> | undefined;
let emailWorkerRegistered = false;
let recoveryTimer: ReturnType<typeof setInterval> | undefined;
let recovering = false;

/** Shared by invitation callers and dispatch. Never fall back to a different
 * origin: bearer-token links must use the explicitly configured canonical app. */
export function getInvitationDeliveryConfiguration(): { origin: string; invitationPreferencesUrl: string; privacyUrl: string } | undefined {
  const configured = process.env.APP_URL;
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    const localHttp = process.env.NODE_ENV === "development" && url.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp) return undefined;
    if (configured !== url.origin && configured !== `${url.origin}/`) return undefined;
    return { origin: url.origin, invitationPreferencesUrl: `${url.origin}/invitation-preferences`, privacyUrl: `${url.origin}/privacy` };
  } catch { return undefined; }
}

const invitationUuid = z.string().uuid();
function validInvitationIdentity(email: AppEmail) {
  if (!invitationUuid.safeParse(email.invitationId).success || email.userId !== undefined
    || email.dedupeKey !== `friend-invitation:${email.invitationId}`) return false;
  const configuration = getInvitationDeliveryConfiguration();
  if (!configuration || typeof email.invitationUnsubscribeUrl !== "string") return false;
  const prefix = `${configuration.invitationPreferencesUrl}#token=`;
  return email.invitationUnsubscribeUrl.startsWith(prefix)
    && /^[a-f0-9]{64}$/i.test(email.invitationUnsubscribeUrl.slice(prefix.length));
}

async function sendWithDeadline(input: Parameters<Resend["emails"]["send"]>[0]) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([resend!.emails.send(input), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Email dispatch timed out")), 30_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}


export function wrapEmail(email: AppEmail) {
  const invitation = email.type === "friend_invitation";
  const fallbackGreeting = invitation ? "Hi there," : "Hello,";
  const name = email.recipientName ? `Hi ${escapeHtml(email.recipientName)},` : fallbackGreeting;
  const unsubscribe = invitation ? email.invitationUnsubscribeUrl! : `${process.env.APP_URL ?? "https://www.thesocialpundit.com"}/dashboard/settings?tab=notifications`;
  const unsubscribeLabel = invitation ? "Stop invitation emails" : "Manage email preferences";
  const privacy = invitation ? getInvitationDeliveryConfiguration()!.privacyUrl : `${process.env.APP_URL ?? "https://www.thesocialpundit.com"}/privacy`;
  const secondary = email.secondaryCta ? `<a href="${escapeHtml(email.secondaryCta.url)}" style="display:inline-block;margin-top:8px;border:1px solid ${emailColor("input")};background:${emailColor("card")};color:${emailColor("card-foreground")};padding:12px 21px;border-radius:6px;text-decoration:none;font-weight:700">${escapeHtml(email.secondaryCta.label)}</a>` : "";
  const cta = email.primaryCta ? `<p style="margin:24px 0"><a href="${escapeHtml(email.primaryCta.url)}" style="display:inline-block;margin:8px 8px 0 0;background:${emailColor("primary")};color:${emailColor("primary-foreground")};padding:13px 22px;border-radius:6px;text-decoration:none;font-weight:700">${escapeHtml(email.primaryCta.label)}</a>${secondary}</p><p style="font-size:12px;color:${emailColor("muted-foreground")};overflow-wrap:anywhere;word-break:break-all">If the button does not work, copy this link: ${escapeHtml(email.primaryCta.url)}</p>` : "";
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><span style="display:none!important;opacity:0;height:0;width:0">${escapeHtml(email.preheader ?? email.subject)}</span></head><body style="margin:0;padding:0 12px;background:${emailColor("background")};font-family:Arial,sans-serif;color:${emailColor("foreground")}"><main style="max-width:600px;margin:32px auto;background:${emailColor("card")};color:${emailColor("card-foreground")};border:1px solid ${emailColor("border")};border-radius:8px;overflow:hidden"><header style="background:${emailColor("card")};color:${emailColor("card-foreground")};padding:24px 28px;border-bottom:3px solid ${emailColor("primary")}"><div style="font-size:20px;font-weight:700">TheSocialPundit</div><div style="margin-top:6px;color:${emailColor("muted-foreground")};font-size:11px;text-transform:uppercase;letter-spacing:1.5px">Your professional signal</div></header><section style="padding:28px"><p style="margin-top:0;color:${emailColor("muted-foreground")};font-size:11px;text-transform:uppercase;letter-spacing:1.4px">${escapeHtml(email.eyebrow ?? "TheSocialPundit")}</p><p>${name}</p>${email.html}${cta}${email.afterCta ?? ""}</section><footer style="border-top:1px solid ${emailColor("border")};padding:18px 28px;color:${emailColor("muted-foreground")};font-size:12px">You received this email from TheSocialPundit.<br><a href="${escapeHtml(unsubscribe)}" style="color:${emailColor("primary")}">${unsubscribeLabel}</a> · <a href="${escapeHtml(privacy)}" style="color:${emailColor("primary")}">Privacy</a></footer></main></body></html>`;
}

/** Text version for templates that only supply HTML: HTML-only mail is more often filtered as spam. */
function plainText(email: AppEmail) {
  const decode = (value: string) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  const toText = (html: string) => decode(html.replace(/<\/(?:p|h[1-6]|li|article|div)>|<br\s*\/?>/gi, "\n\n").replace(/<[^>]*>/g, ""))
    .split(/\n{2,}/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n\n");
  const body = email.text?.trim() || toText(email.html);
  const cta = [email.primaryCta, email.secondaryCta].map(button => button ? `\n\n${button.label}: ${button.url}` : "").join("");
  const after = email.afterCta ? `\n\n${toText(email.afterCta)}` : "";
  if (email.type === "friend_invitation") {
    const greeting = email.recipientName ? `Hi ${email.recipientName},` : "Hi there,";
    return `${greeting}\n\n${body}${cta}${after}\n\nStop invitation emails: ${email.invitationUnsubscribeUrl}\nPrivacy: ${getInvitationDeliveryConfiguration()!.privacyUrl}`;
  }
  return `${email.recipientName ? `Hi ${email.recipientName},` : "Hello,"}\n\n${body}${cta}${after}\n\nTheSocialPundit`;
}

async function deliveryAllowed(email: AppEmail) {
  if (email.type === "friend_invitation") {
    if (!validInvitationIdentity(email)) return false;
    const { invitationDeliveryAllowed } = await import("../invitations-store");
    return invitationDeliveryAllowed(email.invitationId!, email.recipient);
  }
  if (!email.userId && !isEssentialEmail(email.type)) return false;
  const preference = email.userId ? await getEmailPreferences(email.userId) : undefined;
  return preferenceEnabled(email.type, preference);
}

function withDeliveryIdentity(email: AppEmail): AppEmail {
  return deliveryKey(email) ? email : { ...email, dedupeKey: randomUUID() };
}

export async function deliverAppEmail(email: AppEmail): Promise<{ skipped?: boolean; messageId?: string }> {
  // `required` affects transport only; callers cannot bypass category policy.
  if (!await deliveryAllowed(email)) return { skipped: true };
  if (!resend) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  // Direct keyless calls are fresh requests (including auth emails), not job
  // retries. The worker must reject keyless retained payloads BEFORE this point.
  email = withDeliveryIdentity(email);
  const claim = await claimDelivery(email);
  if (!claim) return { skipped: true };
  // Recheck after claiming, immediately before dispatch, including queued jobs.
  if (!await deliveryAllowed(email)) {
    await finishDelivery(claim, "suppressed");
    return { skipped: true };
  }
  const html = wrapEmail(email);
  if (!await beginDelivery(claim)) return { skipped: true };
  let result;
  try {
    result = await sendWithDeadline({ from: `${FROM_NAME} <${FROM_EMAIL}>`, to: [email.recipient], subject: email.subject, html, text: plainText(email) });
  } catch {
    await finishDelivery(claim, "unknown");
    throw new Error("Email delivery outcome is unknown; do not replay");
  }
  if (result.error) {
    // Resend also returns application_error for caught network/JSON failures.
    const rejected = ["validation_error", "missing_required_field", "invalid_access", "invalid_api_key", "restricted_api_key", "rate_limit_exceeded"].includes(result.error.name);
    await finishDelivery(claim, rejected ? "failed" : "unknown");
    throw new Error(rejected ? "Email provider rejected delivery" : "Email outcome unknown; do not replay");
  }
  if (!result.data?.id) {
    await finishDelivery(claim, "unknown");
    throw new Error("Email delivery receipt missing; do not replay");
  }
  // If this write fails the stale sending lease becomes unknown, never failed.
  await finishDelivery(claim, "sent", result.data.id);
  return { messageId: result.data.id };
}

export function initializeEmailQueue() {
  // Recovery also runs when optional queue/digest sending is disabled. It never
  // sends messages, and therefore cannot turn uncertainty into a blind replay.
  if (!recoveryTimer && process.env.BACKGROUND_JOBS_ENABLED !== "false") {
    recoveryTimer = setInterval(async () => {
      if (recovering) return;
      recovering = true;
      try { await recoverEmailDeliveries(); }
      catch { console.error("[email] Delivery recovery unavailable"); }
      finally { recovering = false; }
    }, 60_000);
    recoveryTimer.unref();
  }
  if (emailQueue) return emailQueue;
  if (!process.env.REDIS_URL || process.env.EMAIL_QUEUE_ENABLED !== "true") return undefined;
  const redisUrl = new URL(process.env.REDIS_URL);
  emailQueue = new Bull<AppEmail>("email_delivery", {
    prefix: queuePrefix(),
    redis: { host: redisUrl.hostname, port: Number(redisUrl.port || 6379), password: redisUrl.password || undefined, tls: redisUrl.protocol === "rediss:" ? {} : undefined },
    defaultJobOptions: { attempts: 4, backoff: { type: "exponential", delay: 65000 }, removeOnComplete: { age: 86400 }, removeOnFail: { age: 604800 } },
  });
  return emailQueue;
}

export function registerEmailWorker() {
  if (process.env.BACKGROUND_JOBS_ENABLED === "false") {
    console.log("[email] Queue worker explicitly disabled; producer remains available");
    return;
  }
  if (!emailQueue || emailWorkerRegistered) return;
  emailWorkerRegistered = true;
  emailQueue.process(3, async (job) => {
    if (!deliveryKey(job.data)) {
      // Even attemptsMade=0 cannot prove that a stalled legacy worker never
      // dispatched. A new UUID or hash of job.id cannot find its old null-key row.
      // Retain as failed for review, never as a successful send or retryable job.
      job.discard();
      console.warn("[email] Job quarantined: missing durable delivery identity; manual reconciliation required; not sent");
      throw new Error("Email job quarantined: missing durable delivery identity; manual reconciliation required; not sent");
    }
    return deliverAppEmail(job.data);
  });
  emailQueue.on("failed", () => console.error("[email] Delivery job failed; inspect delivery status"));
}

export async function closeEmailQueue() {
  if (recoveryTimer) clearInterval(recoveryTimer);
  recoveryTimer = undefined;
  if (emailQueue) await emailQueue.close();
  emailQueue = undefined;
  emailWorkerRegistered = false;
}

export async function sendAppEmail(email: AppEmail): Promise<{ skipped?: boolean; messageId?: string; queued?: boolean }> {
  // Invitations cannot acquire an arbitrary generated identity or bypass their
  // recipient policy by entering the queue. Dispatch still rechecks twice.
  if (email.type === "friend_invitation" && !await deliveryAllowed(email)) return { skipped: true };
  // A queued retry must retain the same identity even for callers without a key.
  email = withDeliveryIdentity(email);
  if (emailQueue && !email.required) {
    await emailQueue.add(email, { jobId: deliveryKey(email) ?? undefined });
    return email.type === "friend_invitation" ? { queued: true } : { skipped: true };
  }
  return deliverAppEmail(email);
}

export async function sendVerificationEmail(email: string, name: string, verificationUrl: string): Promise<void> {
  await sendAppEmail({ type: "verification", recipient: email, recipientName: name, subject: "Verify your TheSocialPundit email", eyebrow: "Account security", html: `<p>Please verify your email address to finish creating your account.</p><p>This link expires in one hour. If you did not create this account, you can safely ignore this message.</p>`, primaryCta: { label: "Verify email address", url: verificationUrl }, required: true, dedupeKey: `verification:${email}:${verificationUrl}` });
}

/** Sent when someone signs up with this address; the sign-up response itself stays generic. */
export async function sendExistingAccountEmail(email: string, name: string, signInUrl: string): Promise<void> {
  await sendAppEmail({ type: "existing_account", recipient: email, recipientName: name, subject: "You already have a TheSocialPundit account", eyebrow: "Account security", html: `<p>Someone tried to create a TheSocialPundit account with this email address. You already have an account, so no new one was created.</p><p>If this was you, sign in instead. If you have forgotten your password, choose "Forgot password" on the sign-in page.</p><p>If it was not you, you can ignore this email. Your account has not changed.</p>`, primaryCta: { label: "Sign in", url: signInUrl }, required: true });
}

/** Security notice after a password reset; each change gets its own delivery. */
export async function sendPasswordChangedEmail(email: string, name: string, userId: string): Promise<void> {
  await sendAppEmail({ type: "password_changed", recipient: email, recipientName: name, userId, required: true, ...emailTemplates.passwordChanged(), dedupeKey: `password-changed:${userId}:${Date.now()}` });
}

export async function sendPasswordResetEmail(email: string, name: string, resetUrl: string): Promise<void> {
  await sendAppEmail({ type: "password_reset", recipient: email, recipientName: name, subject: "Reset your TheSocialPundit password", eyebrow: "Account security", html: `<p>Use the link below to create a new password.</p><p>If you did not request this, you can safely ignore this email.</p>`, primaryCta: { label: "Reset password", url: resetUrl }, required: true });
}

export { emailTemplates };
