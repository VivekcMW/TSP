/**
 * Builders for the product events sent to Google Analytics 4 (see `track` in
 * analytics-consent.ts). Each describes an action, never a person: plans, platforms
 * and methods go in; emails, names, IDs and draft text never do.
 */
import type { PublicBillingPlan } from "./billing";

type PlanSummary = Pick<PublicBillingPlan, "id" | "name" | "amount" | "currency" | "interval">;

const majorUnits = (minor: number) => Math.round(minor) / 100;

function planItems(plan: PlanSummary) {
  return [{ item_id: plan.id, item_name: plan.name, item_variant: plan.interval, price: majorUnits(plan.amount), quantity: 1 }];
}

/** GA4 `begin_checkout`: the visitor opened Razorpay Checkout for this plan. */
export function beginCheckoutParams(plan: PlanSummary) {
  return { currency: plan.currency, value: majorUnits(plan.amount), items: planItems(plan) };
}

/** GA4 `purchase`: the payment was verified. The payment id is the transaction id. */
export function purchaseParams(plan: PlanSummary, paymentId: string) {
  return { transaction_id: paymentId, ...beginCheckoutParams(plan) };
}

const GENERATION_SURFACES: Record<string, string> = {
  "/api/ai/generate-post": "create",
  "/api/instant-review/selected": "instant_review",
  "/api/instant-review/manual": "instant_review",
};

/** `generate_post` for a successful editorial request, or null when the endpoint is not a generation. */
export function editorialEvent(endpoint: string, body: unknown): { name: "generate_post"; params: Record<string, string> } | null {
  const surface = GENERATION_SURFACES[endpoint];
  if (!surface) return null;
  const input = (body ?? {}) as { platform?: unknown; platforms?: unknown; tone?: unknown; tones?: unknown };
  const params: Record<string, string> = { surface };
  const platform = typeof input.platform === "string" ? input.platform
    : Array.isArray(input.platforms) ? input.platforms.filter(p => typeof p === "string").join(",") : "";
  if (platform) params.platform = platform;
  const tone = typeof input.tone === "string" ? input.tone : Array.isArray(input.tones) && typeof input.tones[0] === "string" ? input.tones[0] : "";
  if (tone) params.tone = tone;
  return { name: "generate_post", params };
}

const AUTH_METHOD_KEY = "tsp-auth-method";
const AUTH_METHOD_TTL_MS = 15 * 60 * 1000;

/** Notes which sign-in method was just started, so the session that follows can be attributed to it. */
export function rememberAuthMethod(method: string): void {
  try { sessionStorage.setItem(AUTH_METHOD_KEY, `${method}|${Date.now()}`); } catch { /* storage blocked: the sign-in is simply not attributed */ }
}

/** The method noted by `rememberAuthMethod`, once; null if none, or if the attempt is stale (abandoned). */
export function takeAuthMethod(): string | null {
  try {
    const stored = sessionStorage.getItem(AUTH_METHOD_KEY);
    if (!stored) return null;
    sessionStorage.removeItem(AUTH_METHOD_KEY);
    const [method, startedAt] = stored.split("|");
    return method && Date.now() - Number(startedAt) <= AUTH_METHOD_TTL_MS ? method : null;
  } catch { return null; }
}

const NEW_ACCOUNT_WINDOW_MS = 5 * 60 * 1000;

/**
 * A session appearing after sign-in is a `sign_up` when the account is brand new,
 * otherwise a `login`. Social providers return through the same callback, so the
 * account's age is the only reliable signal.
 */
export function authReturnEvent(user: { createdAt?: string | Date | null }, method: string, now = Date.now()) {
  const created = user.createdAt ? new Date(user.createdAt).getTime() : NaN;
  const isNew = Number.isFinite(created) && now - created <= NEW_ACCOUNT_WINDOW_MS;
  return { name: isNew ? "sign_up" : "login", params: { method } } as const;
}
