import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { newsletterSubscribers } from "@shared/schema";
import { NEWSLETTER_PROMISE, type NEWSLETTER_SOURCES } from "@shared/newsletter";

/**
 * Double opt-in newsletter sign-ups. A request stores a pending row and returns whether to
 * email a confirmation link; the row counts as subscribed only after that link is confirmed.
 * Links are `${id}.${hmac(purpose, id, nonce)}`: nothing secret is stored, any link can be
 * rebuilt at send time, and rotating the nonce invalidates every earlier link.
 */
export type NewsletterPurpose = "confirm" | "unsubscribe";
export type NewsletterSource = typeof NEWSLETTER_SOURCES[number];

const RESEND_AFTER_MS = 60 * 60_000;
const CONFIRM_WITHIN_MS = 7 * 24 * 60 * 60_000;

/** A key of its own, derived from the auth secret, so these links can't be replayed elsewhere. */
export function newsletterSecret(): Buffer {
  const base = process.env.BETTER_AUTH_SECRET;
  if (!base) throw new Error("BETTER_AUTH_SECRET is not configured");
  return createHmac("sha256", base).update("tsp-newsletter-links-v1").digest();
}

const sign = (purpose: NewsletterPurpose, id: string, nonce: string, secret: Buffer) =>
  createHmac("sha256", secret).update(`${purpose}:${id}:${nonce}`).digest("base64url");

export function newsletterToken(purpose: NewsletterPurpose, id: string, nonce: string, secret: Buffer = newsletterSecret()) {
  return `${id}.${sign(purpose, id, nonce, secret)}`;
}

export function tokenMatches(purpose: NewsletterPurpose, token: string, id: string, nonce: string, secret: Buffer = newsletterSecret()) {
  const expected = Buffer.from(newsletterToken(purpose, id, nonce, secret));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const appUrl = () => process.env.APP_URL ?? "https://www.thesocialpundit.com";
export const confirmUrl = (id: string, nonce: string) => `${appUrl()}/newsletter?confirm=${encodeURIComponent(newsletterToken("confirm", id, nonce))}`;
export const unsubscribeUrl = (id: string, nonce: string) => `${appUrl()}/newsletter?unsubscribe=${encodeURIComponent(newsletterToken("unsubscribe", id, nonce))}`;

const newNonce = () => randomBytes(16).toString("hex");

/** Records a sign-up. `send` says whether to email a confirmation link now (at most one an hour). */
export async function requestSubscription(email: string, source: NewsletterSource, now = new Date()): Promise<{ id: string; nonce: string; send: boolean }> {
  const address = email.trim().toLowerCase();
  const nonce = newNonce();
  const [created] = await db.insert(newsletterSubscribers)
    .values({ email: address, status: "pending", tokenNonce: nonce, source, consentText: NEWSLETTER_PROMISE, requestedAt: now, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: newsletterSubscribers.email }).returning();
  if (created) return { id: created.id, nonce, send: true };

  const [existing] = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.email, address)).limit(1);
  if (!existing) throw new Error("Newsletter sign-up could not be recorded");
  const recentlySent = existing.confirmationSentAt && now.getTime() - existing.confirmationSentAt.getTime() < RESEND_AFTER_MS;
  if (existing.status === "confirmed" || recentlySent) return { id: existing.id, nonce: existing.tokenNonce, send: false };
  await db.update(newsletterSubscribers)
    .set({ status: "pending", tokenNonce: nonce, source, consentText: NEWSLETTER_PROMISE, requestedAt: now, updatedAt: now })
    .where(eq(newsletterSubscribers.id, existing.id));
  return { id: existing.id, nonce, send: true };
}

export async function markConfirmationSent(id: string, now = new Date()) {
  await db.update(newsletterSubscribers).set({ confirmationSentAt: now, updatedAt: now }).where(eq(newsletterSubscribers.id, id));
}

async function findByToken(purpose: NewsletterPurpose, token: string) {
  const id = token.split(".")[0];
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.id, id)).limit(1);
  return row && tokenMatches(purpose, token, row.id, row.tokenNonce) ? row : null;
}

export async function confirmSubscription(token: string, now = new Date()): Promise<"confirmed" | "invalid"> {
  const row = await findByToken("confirm", token);
  if (!row || row.status === "unsubscribed") return "invalid";
  if (row.status === "confirmed") return "confirmed";
  if (now.getTime() - row.requestedAt.getTime() > CONFIRM_WITHIN_MS) return "invalid";
  await db.update(newsletterSubscribers).set({ status: "confirmed", confirmedAt: now, updatedAt: now }).where(eq(newsletterSubscribers.id, row.id));
  return "confirmed";
}

export async function unsubscribe(token: string, now = new Date()): Promise<"unsubscribed" | "invalid"> {
  const row = await findByToken("unsubscribe", token);
  if (!row) return "invalid";
  if (row.status !== "unsubscribed") {
    await db.update(newsletterSubscribers).set({ status: "unsubscribed", unsubscribedAt: now, updatedAt: now }).where(eq(newsletterSubscribers.id, row.id));
  }
  return "unsubscribed";
}
