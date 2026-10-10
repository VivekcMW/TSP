import type { Subscription } from "@shared/schema";
import type { RazorpaySubscription } from "./razorpay";

export class BillingError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message);
  }
}

export function providerDate(seconds: number | null | undefined): Date | null {
  if (!Number.isSafeInteger(seconds) || (seconds ?? 0) <= 0) return null;
  const date = new Date(seconds! * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Orders buy a single calendar interval, not an automatically renewing mandate. */
export function orderPeriodEnd(start: Date, interval: string): Date {
  const result = new Date(start);
  if (!Number.isFinite(start.getTime())) throw new BillingError(400, "invalid_period", "Invalid payment date");
  if (interval === "daily" || interval === "weekly") {
    result.setUTCDate(result.getUTCDate() + (interval === "daily" ? 1 : 7));
    return result;
  }
  const months = new Map([["monthly", 1], ["quarterly", 3], ["yearly", 12], ["annual", 12]]).get(interval);
  if (!months) throw new BillingError(409, "unsupported_interval", "This plan interval is not supported by order checkout");
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

const terminal = new Set(["cancelled", "completed", "expired"]);
const statuses = new Set(["created", "authenticated", "active", "pending", "halted", "paused", ...terminal]);

/** Apply fetched current provider state, not the (potentially old) webhook snapshot. */
export function subscriptionPatch(local: Subscription, remote: RazorpaySubscription): Partial<Subscription> {
  if (!statuses.has(remote.status)) throw new BillingError(502, "provider_state_invalid", "Unknown subscription state");
  if (terminal.has(local.status) && !terminal.has(remote.status)) return {};
  const start = providerDate(remote.current_start);
  const end = providerDate(remote.current_end);
  if (remote.status === "active" && (!start || !end || end <= start)) {
    throw new BillingError(502, "provider_period_invalid", "Provider did not return a valid billing period");
  }
  if (!terminal.has(remote.status) && end && local.currentPeriodEnd && end < local.currentPeriodEnd) return {};
  return {
    status: remote.status,
    currentPeriodStart: start ?? local.currentPeriodStart,
    currentPeriodEnd: end ?? local.currentPeriodEnd,
    // A successful cycle-end cancellation must survive subsequent active snapshots.
    cancelAtPeriodEnd: local.cancelAtPeriodEnd,
    endedAt: providerDate(remote.ended_at) ?? local.endedAt,
    updatedAt: new Date(),
  };
}

export function paymentCanAdvance(previous: string | undefined, next: string): boolean {
  if (!["created", "authorized", "failed", "captured", "refunded"].includes(next)) return false;
  if (!previous) return true;
  if (previous === next || previous === "refunded") return false;
  if (previous === "captured") return next === "refunded";
  if (previous === "failed") return next === "captured" || next === "refunded";
  return true;
}