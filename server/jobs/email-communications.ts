import { storage, type TenantScope } from "../storage";
import { recoverEmailDeliveries } from "../services/email/delivery-store";
import { runBillingNotificationBatch } from "../services/email/billing-notifications";
import { runAnnouncementBatch } from "../services/email/announcements";
import { sendWeeklySummaryForScope } from "./email-weekly-summary";

let cursor: TenantScope | undefined;
export async function runEmailCommunicationsCycle(assertConnected: () => Promise<void> = async () => undefined) {
  const deadline = Date.now() + 45_000;
  await recoverEmailDeliveries();
  // Give weekly summaries their own admission budget before slower outbox sends.
  if (process.env.EMAIL_WEEKLY_SUMMARY_ENABLED === "true") {
    const scopes = await storage.getSchedulerScopes(cursor);
    if (!scopes.length) cursor = undefined;
    for (const scope of scopes) {
      if (Date.now() >= deadline - 15_000) break;
      await assertConnected();
      try { await sendWeeklySummaryForScope(scope); }
      catch { console.error("[email:weekly] Scoped summary failed; retry pending"); }
      cursor = scope;
    }
  }
  await runBillingNotificationBatch(assertConnected, deadline);
  if (process.env.EMAIL_ANNOUNCEMENTS_ENABLED === "true") await runAnnouncementBatch(assertConnected, deadline);
}
