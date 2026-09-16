import crypto from "node:crypto";

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  notes?: Record<string, string>;
}

export interface RazorpayPayment {
  id: string;
  order_id?: string;
  amount: number;
  currency: string;
  status: string;
  method?: string;
  card?: { network?: string; last4?: string };
  vpa?: string;
  error_code?: string;
  error_description?: string;
}

export interface RazorpayCustomer {
  id: string;
  name: string;
  email: string;
}

export function razorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export function razorpayWebhookConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_WEBHOOK_SECRET);
}

function requireCredentials(): { keyId: string; keySecret: string } {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("Razorpay is not configured");
  return { keyId, keySecret };
}

async function razorpayRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { keyId, keySecret } = requireCredentials();
  const basicCredentials = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Basic ${basicCredentials}`);
  headers.set("Content-Type", "application/json");
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body?.error?.description === "string" ? body.error.description : "Razorpay request failed");
  }
  return body as T;
}

export function getRazorpayKeyId(): string | null {
  return process.env.RAZORPAY_KEY_ID ?? null;
}

export async function createOrder(input: { amount: number; currency: string; receipt: string; notes: Record<string, string> }): Promise<RazorpayOrder> {
  return razorpayRequest<RazorpayOrder>("/orders", {
    method: "POST",
    body: JSON.stringify({ amount: input.amount, currency: input.currency, receipt: input.receipt.slice(0, 40), notes: input.notes }),
  });
}

export async function createCustomer(input: { name: string; email: string; notes: Record<string, string> }): Promise<RazorpayCustomer> {
  return razorpayRequest<RazorpayCustomer>("/customers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function fetchOrder(orderId: string): Promise<RazorpayOrder> {
  return razorpayRequest<RazorpayOrder>(`/orders/${encodeURIComponent(orderId)}`);
}

export async function fetchPayment(paymentId: string): Promise<RazorpayPayment> {
  return razorpayRequest<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}`);
}

export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  const provided = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return provided.length === expectedBuffer.length && crypto.timingSafeEqual(expectedBuffer, provided);
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return provided.length === expectedBuffer.length && crypto.timingSafeEqual(expectedBuffer, provided);
}

export function hashWebhookPayload(rawBody: Buffer): string {
  return crypto.createHash("sha256").update(rawBody).digest("hex");
}

export function maskVpa(vpa?: string): string | null {
  if (!vpa) return null;
  const [name, domain] = vpa.split("@");
  if (!domain) return "••••";
  return `${name.slice(0, 1)}••••@${domain}`;
}
