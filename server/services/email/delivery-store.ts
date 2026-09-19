import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { emailDeliveries } from "@shared/schema";
import type { AppEmail } from "./index";

export function deliveryKey(email: AppEmail): string | null {
  // Verification URLs and other potential secrets never appear in DB/queue keys.
  return typeof email.dedupeKey === "string" && email.dedupeKey.trim() ? createHash("sha256").update(JSON.stringify([email.userId ?? email.recipient, email.type, email.dedupeKey])).digest("hex") : null;
}
export async function claimDelivery(email: AppEmail) {
  const key = deliveryKey(email);
  // Never create an unfindable delivery row or invent identity at retry time.
  if (!key) throw new Error("Email delivery requires a durable identity");
  const token = randomUUID();
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    const existing = (await tx.select().from(emailDeliveries).where(eq(emailDeliveries.dedupeKey, key)).limit(1))[0];
    if (existing) {
      if (existing.status === "sending" && (!existing.leaseUntil || existing.leaseUntil.getTime() <= Date.now())) {
        await tx.update(emailDeliveries).set({ status: "unknown", claimToken: null, leaseUntil: null, errorMessage: "Delivery outcome requires reconciliation" })
          .where(eq(emailDeliveries.id, existing.id));
        return undefined;
      }
      if (existing.status === "pending" && existing.leaseUntil && existing.leaseUntil.getTime() > Date.now()) {
        throw new Error("Email pre-dispatch claim busy; retry later");
      }
      if (!["pending", "failed"].includes(existing.status) || existing.attempts >= 4
        || (existing.leaseUntil && existing.leaseUntil.getTime() > Date.now())
        || (existing.retryAt && existing.retryAt.getTime() > Date.now())) return undefined;
    }
    const data = { status: "pending", claimToken: token, leaseUntil: new Date(Date.now() + 120_000), retryAt: null,
      errorMessage: null, attempts: (existing?.attempts ?? 0) + 1 };
    const [row] = existing
      ? await tx.update(emailDeliveries).set(data).where(eq(emailDeliveries.id, existing.id)).returning()
      : await tx.insert(emailDeliveries).values({ ...data, dedupeKey: key, userId: email.userId ?? null,
        recipient: email.recipient, type: email.type }).returning();
    return { id: row.id, token };
  });
}
export type DeliveryClaim = NonNullable<Awaited<ReturnType<typeof claimDelivery>>>;
export async function beginDelivery(claim: DeliveryClaim) {
  const [row] = await db.update(emailDeliveries).set({ status: "sending", leaseUntil: new Date(Date.now() + 120_000) })
    .where(and(eq(emailDeliveries.id, claim.id), eq(emailDeliveries.claimToken, claim.token), eq(emailDeliveries.status, "pending"),
      sql`${emailDeliveries.leaseUntil} > clock_timestamp()`)).returning({ id: emailDeliveries.id });
  return !!row;
}
export async function finishDelivery(claim: DeliveryClaim, status: "sent" | "failed" | "unknown" | "suppressed", messageId?: string) {
  const errors = { failed: "Provider rejected delivery", unknown: "Delivery outcome requires reconciliation", sent: null, suppressed: null };
  await db.update(emailDeliveries).set({ status, claimToken: null, leaseUntil: null,
    providerMessageId: messageId ?? null, sentAt: status === "sent" ? new Date() : null,
    retryAt: status === "failed" ? new Date(Date.now() + 60_000) : null,
    errorMessage: errors[status],
  }).where(and(eq(emailDeliveries.id, claim.id), eq(emailDeliveries.claimToken, claim.token)));
}

/** Bounded recovery: expired pre-dispatch claims remain retryable; a dispatch
 * that might have reached the provider becomes unknown, never blindly replayed. */
export async function recoverEmailDeliveries() {
  await db.execute(sql`update email_deliveries set status = 'failed', claim_token = null, lease_until = null, retry_at = now(),
    error_message = 'Expired before dispatch; safe to retry'
    where id in (select id from email_deliveries where status = 'pending' and claim_token is not null and lease_until <= now()
      order by lease_until, id limit 100 for update skip locked)`);
  await db.execute(sql`update email_deliveries set status = 'unknown', claim_token = null, lease_until = null,
    error_message = 'Delivery outcome requires reconciliation'
    where id in (select id from email_deliveries where status = 'sending' and lease_until <= now()
      order by lease_until, id limit 100 for update skip locked)`);
  // Legacy pending rows have no dispatch boundary and therefore are uncertain.
  await db.execute(sql`update email_deliveries set status = 'unknown', error_message = 'Legacy delivery requires reconciliation'
    where id in (select id from email_deliveries where status = 'pending' and claim_token is null
      and created_at < now() - interval '10 minutes' order by created_at, id limit 100 for update skip locked)`);
}