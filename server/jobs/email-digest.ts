import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { inboxItems, users } from "@shared/schema";
import { storage, type TenantScope } from "../storage";
import { getEmailPreferences } from "../services/email/preferences";
import { digestSlot, preferenceEnabled } from "../services/email/policy";
import { deliverAppEmail, emailTemplates } from "../services/email";
import { recoverEmailDeliveries } from "../services/email/delivery-store";
import { sendReminderForScope } from "./email-reminders";

export async function sendDigestForScope(scope: TenantScope, now = new Date()) {
  const preference = await getEmailPreferences(scope.userId);
  if (!preferenceEnabled("daily_digest", preference)) return;
  const slot = digestSlot(now, preference.digestTimezone, preference.digestTime);
  if (!slot) return;
  const [user] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, scope.userId)).limit(1);
  if (!user?.email) return;
  const articles = await db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.tenant_id', ${scope.tenantId}, true)`);
    return tx.select({ source: sql<string>`left(${inboxItems.source}, 120)`, headline: sql<string>`left(${inboxItems.headline}, 300)`,
      summary: sql<string>`left(coalesce(${inboxItems.summary}, ''), 600)`, url: sql<string>`left(${inboxItems.articleUrl}, 2048)` })
      .from(inboxItems).where(and(eq(inboxItems.tenantId, scope.tenantId), eq(inboxItems.userId, scope.userId), eq(inboxItems.status, "active")))
      .orderBy(sql`coalesce(${inboxItems.rankingScore}, ${inboxItems.relevanceScore}) desc nulls last`, inboxItems.id).limit(5);
  });
  // Never put credentials or non-web URLs from legacy inbox rows into an email.
  const safe = articles.filter(article => {
    try { const url = new URL(article.url); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }
    catch { return false; }
  });
  if (!safe.length) return;
  await deliverAppEmail({ type: "daily_digest", userId: scope.userId, recipient: user.email, recipientName: user.name ?? undefined,
    dedupeKey: JSON.stringify(["daily-digest-v1", scope.tenantId, scope.userId, slot]), ...emailTemplates.dailyDigest(safe) });
}

let cursor: TenantScope | undefined;
export async function runEmailDigestCycle(assertConnected: () => Promise<void> = async () => undefined) {
  const deadline = Date.now() + 45_000;
  await recoverEmailDeliveries();
  // One keyset page per cycle, rotated for fairness. Durable delivery slots do
  // not depend on this process cursor and survive Redis loss/restarts.
  const page = await storage.getSchedulerScopes(cursor);
  if (!page.length) { cursor = undefined; return; }
  for (const scope of page) {
    if (Date.now() >= deadline) break;
    await assertConnected();
    try { await sendDigestForScope(scope); }
    catch { console.error("[email:digest] Scoped delivery failed; retry or reconciliation pending"); }
    // Independent of the digest preference and outcome; see services/email/reengagement.ts.
    try { await sendReminderForScope(scope); }
    catch { console.error("[email:reminder] Scoped delivery failed; retry or reconciliation pending"); }
    cursor = scope;
  }
}