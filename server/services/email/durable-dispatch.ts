import { eq } from "drizzle-orm";
import { db } from "../../db";
import { emailDeliveries } from "@shared/schema";
import { deliverAppEmail, type AppEmail } from "./index";
import { deliveryKey } from "./delivery-store";
import { isEssentialEmail, preferenceEnabled } from "./policy";
import { getEmailPreferences } from "./preferences";

export type EmailOutcome = "sent" | "suppressed" | "unknown" | "failed";

/** A skipped claim can mean backoff/busy, not completion. Outbox callers must
 * consult the durable receipt before advancing their own progress. */
export async function dispatchDurableEmail(email: AppEmail): Promise<EmailOutcome | null> {
  const key = deliveryKey(email);
  if (!key) throw new Error("Outbox email requires a stable identity");
  if (!isEssentialEmail(email.type)) {
    if (!email.userId || !preferenceEnabled(email.type, await getEmailPreferences(email.userId))) return "suppressed";
  }
  const result = await deliverAppEmail(email);
  const [receipt] = await db.select({ status: emailDeliveries.status, attempts: emailDeliveries.attempts })
    .from(emailDeliveries).where(eq(emailDeliveries.dedupeKey, key)).limit(1);
  if (!receipt) {
    // Policy can suppress before a delivery row is created.
    if (result.skipped) return "suppressed";
    throw new Error("Outbox delivery receipt missing");
  }
  if (receipt.status === "sent" || receipt.status === "suppressed" || receipt.status === "unknown") return receipt.status;
  if (receipt.status === "failed" && receipt.attempts >= 4) return "failed";
  return null;
}
