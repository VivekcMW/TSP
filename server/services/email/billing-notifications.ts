import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import { billingEmailNotifications, payments } from "@shared/schema";
import { emailTemplates } from "./index";
import { dispatchDurableEmail } from "./durable-dispatch";

export async function runBillingNotificationBatch(assertConnected: () => Promise<void> = async () => undefined, deadline = Date.now() + 30_000, notificationId?: string) {
  const notifications = await db.select().from(billingEmailNotifications)
    .where(and(isNull(billingEmailNotifications.outcome), lte(billingEmailNotifications.retryAt, new Date()),
      notificationId ? eq(billingEmailNotifications.id, notificationId) : undefined))
    .orderBy(billingEmailNotifications.retryAt, billingEmailNotifications.id).limit(10);
  for (const notification of notifications) {
    if (Date.now() >= deadline) break;
    await assertConnected();
    let outcome: Awaited<ReturnType<typeof dispatchDurableEmail>> = null;
    try {
      const status = await db.transaction(async tx => {
        await tx.execute(sql`select set_config('app.tenant_id', ${notification.tenantId}, true)`);
        const [payment] = await tx.select({ status: payments.status }).from(payments)
          .where(and(eq(payments.tenantId, notification.tenantId), eq(payments.razorpayPaymentId, notification.paymentId))).limit(1);
        if (!payment) throw new Error("Payment notification binding unavailable");
        return payment.status;
      });
      outcome = status !== "failed" ? "suppressed" : await dispatchDurableEmail({
        type: "payment_failed", recipient: notification.recipient, recipientName: notification.recipientName, required: true,
        dedupeKey: JSON.stringify(["payment-failed-v1", notification.tenantId, notification.paymentId]),
        ...emailTemplates.paymentFailed("The payment provider could not complete your payment. Please review your billing details and try again."),
      });
    } catch {
      console.error("[email:billing] Payment failure notification pending; inspect durable receipt");
    }
    await db.update(billingEmailNotifications).set({ outcome, retryAt: new Date(Date.now() + 60_000) })
      .where(and(eq(billingEmailNotifications.id, notification.id), isNull(billingEmailNotifications.outcome)));
  }
}
