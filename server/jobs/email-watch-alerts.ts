import type { TenantScope } from "../storage";
import { getEmailPreferences } from "../services/email/preferences";
import { preferenceEnabled } from "../services/email/policy";
import { deliverAppEmail } from "../services/email";
import { watchAlertsEmail, type AlertStory } from "../services/email/planning-templates";
import { closeWatchAlertSlot, takeWatchAlertBatch, watchAlertEmailState, watchAlertEmailedWithinHour, type AlertEmailItem } from "../repositories/watchAlerts";
import { loadRecipient } from "./email-recipient";

/** UTC hour, e.g. "2026-11-16T09": one claimed batch and one delivery identity per hour. */
export const alertSlot = (now: Date) => now.toISOString().slice(0, 13);

// Never put credentials or non-web URLs into an email.
const safeWebUrl = (value: string) => {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
};

/** One entry per story, listing every watched term it mentions. */
export function alertStories(alerts: readonly AlertEmailItem[]): AlertStory[] {
  const stories = new Map<string, AlertStory>();
  for (const alert of alerts) {
    if (!safeWebUrl(alert.articleUrl)) continue;
    const story = stories.get(alert.articleUrl) ?? { headline: alert.headline, source: alert.source, url: alert.articleUrl, terms: [] };
    if (!story.terms.includes(alert.term)) story.terms.push(alert.term);
    stories.set(alert.articleUrl, story);
  }
  return [...stories.values()];
}

type Deps = {
  getEmailPreferences: typeof getEmailPreferences;
  watchAlertEmailState: typeof watchAlertEmailState;
  watchAlertEmailedWithinHour: typeof watchAlertEmailedWithinHour;
  takeWatchAlertBatch: typeof takeWatchAlertBatch;
  closeWatchAlertSlot: typeof closeWatchAlertSlot;
  loadRecipient: typeof loadRecipient;
  deliverAppEmail: typeof deliverAppEmail;
};
const defaults: Deps = { getEmailPreferences, watchAlertEmailState, watchAlertEmailedWithinHour, takeWatchAlertBatch, closeWatchAlertSlot, loadRecipient, deliverAppEmail };

/**
 * Emails unseen watch alerts, at most once an hour. A batch is claimed under an hour slot before dispatch; a failed
 * dispatch is retried with the SAME slot and delivery identity, so the delivery ledger decides whether a retry is
 * safe (sent or unknown outcomes are never replayed). The slot is closed once delivery returns.
 */
export async function sendWatchAlertsForScope(scope: TenantScope, now = new Date(), overrides: Partial<Deps> = {}) {
  const deps = { ...defaults, ...overrides };
  const preferences = await deps.getEmailPreferences(scope.userId);
  if (!preferenceEnabled("watch_alert", preferences)) return;
  const state = await deps.watchAlertEmailState(scope, now);
  if (!state.pendingSlot && !state.claimable) return;
  if (!state.pendingSlot && await deps.watchAlertEmailedWithinHour(scope.userId)) return;
  const slot = state.pendingSlot ?? alertSlot(now);
  const stories = alertStories(await deps.takeWatchAlertBatch(scope, slot, Boolean(state.pendingSlot), now));
  const recipient = stories.length ? await deps.loadRecipient(scope) : null;
  if (!recipient) return deps.closeWatchAlertSlot(scope, slot);
  await deps.deliverAppEmail({
    type: "watch_alert", userId: scope.userId, recipient: recipient.email, recipientName: recipient.name ?? undefined,
    dedupeKey: JSON.stringify(["watch-alerts-v1", scope.tenantId, scope.userId, slot]),
    ...watchAlertsEmail(stories),
  });
  await deps.closeWatchAlertSlot(scope, slot);
}
