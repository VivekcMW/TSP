import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Check, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { color } from "@/design/tokens";
import type { SettingsPageProps } from "@/components/settings/settings-page-props";
import { Input } from "@/components/ui/input";
import { billingCurrencies, billingPeriodLabel, billingStatusLabel, canCancelSubscription, checkoutRequest, checkoutVerification, defaultBillingCurrency, formatBillingAmount as formatAmount, plansForCurrency, type BillingSubscription, type CheckoutMode, type PublicBillingPlan } from "@/lib/billing";
export { billingPeriodLabel } from "@/lib/billing";

declare global {
  interface Window { Razorpay?: new (options: Record<string, unknown>) => { open: () => void }; }
}

interface BillingData {
  configured: boolean;
  keyId: string | null;
  plans: PublicBillingPlan[];
  currentPlan: { id: string; name: string; amount: number; currency: string; interval: string } | null;
  subscription: BillingSubscription | null;
  paymentMethods: Array<{ id: string; type: string; cardNetwork: string | null; lastFour: string | null; upiVpaMasked: string | null; isDefault: boolean }>;
  payments: Array<{ id: string; amount: number; currency: string; status: string; method: string | null; paidAt: string | null }>;
}

async function loadRazorpayScript() {
  if (window.Razorpay) return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => { script.remove(); reject(new Error("Could not load Razorpay Checkout")); };
    document.body.appendChild(script);
  });
}

export function BillingPanel({ compact = false }: Readonly<{ compact?: boolean }>) {
  const cache = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery<BillingData>({ queryKey: ["/api/billing"] });
  const { toast } = useToast();
  const [checkoutPending, setCheckoutPending] = useState<string | null>(null);
  const [checkoutMode, setCheckoutMode] = useState<CheckoutMode>("order");
  const [cycles, setCycles] = useState("");
  const [currency, setCurrency] = useState<string>(() => defaultBillingCurrency({
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, locales: navigator.languages,
  }));
  const invalidateBilling = () => Promise.all([
    cache.invalidateQueries({ queryKey: ["/api/billing"] }),
    cache.invalidateQueries({ queryKey: ["/api/billing/entitlements"] }),
  ]);
  const cancelMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/billing/subscription/cancel")).json() as Promise<{ subscription: BillingSubscription }>,
    onSuccess: ({ subscription: updated }) => {
      void invalidateBilling();
      toast({ title: updated.cancelAtPeriodEnd ? "Subscription cancellation scheduled" : "Subscription ended", description: "Provider confirmation recorded. Refresh billing to check current access." });
    },
    onError: (error: Error) => toast({ title: "Could not cancel subscription", description: error.message, variant: "destructive" }),
  });
  async function startCheckout(planId: string) {
    setCheckoutPending(planId);
    try {
      const mode = checkoutMode;
      const order = await (await apiRequest("POST", `/api/billing/checkout/${mode}`, checkoutRequest(planId, mode, cycles))).json();
      await loadRazorpayScript();
      if (!window.Razorpay) throw new Error("Razorpay Checkout is unavailable");
      const checkout = new window.Razorpay({
        key: order.keyId,
        ...(mode === "subscription" ? { subscription_id: order.subscriptionId } : { order_id: order.orderId, amount: order.amount, currency: order.currency }),
        name: "TheSocialPundit", description: order.plan.name, prefill: order.prefill,
        theme: { color: color("primary") },
        handler: async (response: Parameters<typeof checkoutVerification>[2]) => {
          try {
            await apiRequest("POST", "/api/billing/checkout/verify", checkoutVerification(mode, mode === "subscription" ? order.subscriptionId : order.orderId, response));
            await invalidateBilling();
            toast({ title: "Payment recorded", description: "Check Current plan for effective access. Verification alone does not guarantee an active billing period." });
          } catch (error) {
            toast({ title: "Payment verification pending", description: error instanceof Error ? error.message : "Refresh billing before trying another payment.", variant: "destructive" });
          } finally { setCheckoutPending(null); }
        },
        modal: { ondismiss: () => setCheckoutPending(null) },
      });
      checkout.open();
    } catch (error) {
      toast({ title: "Checkout unavailable", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
      setCheckoutPending(null);
    }
  }
  if (isLoading) return <output>Loading billing information…</output>;
  if (isError || !data) return <Card><CardContent className="p-6"><p role="alert">Billing information is unavailable right now.</p><Button className="mt-4 min-h-11" variant="outline" onClick={() => refetch()}>Retry</Button></CardContent></Card>;
  const subscription = data.subscription;
  const canCancel = canCancelSubscription(subscription);
  const currencies = billingCurrencies(data.plans);
  const shownCurrency = currencies.includes(currency) ? currency : currencies[0];
  const paidPlans = shownCurrency ? plansForCurrency(data.plans, shownCurrency) : [];
  const now = Date.now();
  const billingStatus = billingStatusLabel(subscription, now);
  const periodLabel = billingPeriodLabel(subscription, now);
  return <div className="space-y-6">
    <Card>
      <CardHeader><CardTitle>Billing &amp; Subscription</CardTitle><CardDescription>Manage your plan, payment method, and billing history.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div><p className="text-sm text-muted-foreground">Current plan</p><p className="text-2xl font-semibold">{data.currentPlan?.name ?? "Unavailable"}</p></div>
          <div><p className="text-sm text-muted-foreground">Billing status</p><p className="capitalize">{billingStatus}</p>{periodLabel && subscription?.currentPeriodEnd && <p className="text-sm text-muted-foreground">{periodLabel} {new Date(subscription.currentPeriodEnd).toLocaleDateString()}</p>}</div>
          <p className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4" />Payments via Razorpay</p>
        </div>
        {compact ? <Button asChild className="min-h-11" variant="outline"><Link href="/dashboard/settings?tab=billing">Open Billing</Link></Button> : <>
          {canCancel && <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="text-sm text-muted-foreground">Cancellation requires provider confirmation. Access follows the confirmed subscription status and period.</p><Button className="min-h-11" variant="outline" disabled={cancelMutation.isPending} onClick={() => { if (window.confirm("Request cancellation of this recurring subscription?")) cancelMutation.mutate(); }}>{cancelMutation.isPending ? "Cancelling…" : "Cancel subscription"}</Button></div>}
          {!data.configured && <p className="rounded-md border p-3 text-sm text-muted-foreground">Checkout is currently unavailable. Your existing plan and payment history are shown below.</p>}
        </>}
      </CardContent>
    </Card>
    {!compact && <>
      <Card><CardContent className="space-y-3 p-6">
        <label htmlFor="billing-checkout-mode" className="block text-sm font-medium">Payment type</label>
        <select id="billing-checkout-mode" className="min-h-11 w-full rounded-md border bg-background px-3" value={checkoutMode} disabled={checkoutPending !== null} onChange={event => setCheckoutMode(event.target.value as CheckoutMode)}>
          <option value="order">One-time access — no automatic renewal</option>
          <option value="subscription">Recurring subscription</option>
        </select>
        {checkoutMode === "subscription" && <><label htmlFor="billing-cycles" className="block text-sm font-medium">Number of recurring billing cycles (1–100)</label><Input id="billing-cycles" type="number" min={1} max={100} step={1} value={cycles} disabled={checkoutPending !== null} onChange={event => setCycles(event.target.value)} /><p className="text-sm text-muted-foreground">Charged each catalog interval for the number of cycles you choose. Requires a configured provider plan.</p></>}
        <p className="text-sm text-muted-foreground">One generation attempt covers one bounded request, including its selected platforms. Failed or cancelled attempts after reservation consume allowance; free allowances reset at midnight UTC.</p>
      </CardContent></Card>
      {paidPlans.length > 0 && <Card><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0"><CardTitle>Available plans</CardTitle>
        {currencies.length > 1 && <div role="group" aria-label="Currency" className="inline-flex rounded-md border p-1">{currencies.map((code) =>
          <Button key={code} type="button" size="sm" variant={code === shownCurrency ? "default" : "ghost"} aria-pressed={code === shownCurrency} className="min-h-9 px-3" disabled={checkoutPending !== null} onClick={() => setCurrency(code)}>{code}</Button>)}</div>}
      </CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
        {paidPlans.map((plan) => {
          let label = checkoutMode === "order" ? "Buy one interval" : "Start recurring checkout";
          if (data.currentPlan?.id === plan.id) label = "Current plan";
          if (checkoutPending === plan.id) label = "Opening checkout…";
          return <div key={plan.id} className="rounded-md border p-5"><h3 className="text-lg font-semibold">{plan.name}</h3><p className="text-sm text-muted-foreground">{plan.description}</p><p className="mt-2 text-xl font-semibold">{formatAmount(plan.amount, plan.currency)}<span className="text-sm font-normal"> / {plan.interval} interval</span></p><ul className="my-4 space-y-2">{plan.features.map((feature) => <li key={feature} className="flex gap-2 text-sm"><Check className="h-4 w-4 shrink-0 text-success" />{feature}</li>)}</ul>{checkoutMode === "subscription" && !plan.recurringAvailable && <p className="mb-3 text-sm text-muted-foreground">Recurring checkout is not configured for this plan.</p>}<Button className="min-h-11" disabled={!data.configured || checkoutPending !== null || data.currentPlan?.id === plan.id || (checkoutMode === "subscription" && !plan.recurringAvailable)} onClick={() => startCheckout(plan.id)}>{label}</Button></div>;
        })}
      </CardContent></Card>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Payment Method</CardTitle><CardDescription>Only masked payment details are stored.</CardDescription></CardHeader><CardContent>{data.paymentMethods.length ? data.paymentMethods.map((method) => <div key={method.id} className="border-b py-3 last:border-0"><p>{method.cardNetwork ? `${method.cardNetwork} •••• ${method.lastFour ?? ""}` : method.upiVpaMasked ?? method.type}</p><p className="text-sm text-muted-foreground">{method.isDefault ? "Default payment method" : "Payment method"}</p></div>) : <p className="text-sm text-muted-foreground">No payment method on file. Choose a paid plan to add one securely through Razorpay.</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Payment History</CardTitle></CardHeader><CardContent>{data.payments.length ? data.payments.map((payment) => <div key={payment.id} className="flex justify-between gap-3 border-b py-3 last:border-0"><div><p className="text-sm">{payment.paidAt ? new Date(payment.paidAt).toLocaleDateString() : "Processing"} · {payment.method ?? "Payment"}</p><p className="text-sm capitalize text-muted-foreground">{payment.status}</p></div><p>{formatAmount(payment.amount, payment.currency)}</p></div>) : <p className="text-sm text-muted-foreground">No payments yet.</p>}</CardContent></Card>
      </div>
    </>}
  </div>;
}

export default function BillingPage({ embedded = false }: SettingsPageProps = {}) {
  if (embedded) return <BillingPanel />;
  return <div className="flex h-full flex-col overflow-hidden"><PageHeader icon={CreditCard} title="Billing" subtitle="Manage your plan, payments, and subscription." /><main className="flex-1 overflow-y-auto p-4 sm:p-6"><div className="mx-auto w-full max-w-5xl"><BillingPanel /></div></main></div>;
}