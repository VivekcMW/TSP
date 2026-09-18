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

declare global {
  interface Window { Razorpay?: new (options: Record<string, unknown>) => { open: () => void }; }
}

interface BillingData {
  configured: boolean;
  keyId: string | null;
  plans: Array<{ id: string; key: string; name: string; description: string | null; amount: number; currency: string; interval: string; features: string[] }>;
  currentPlan: { id: string; name: string; amount: number; currency: string; interval: string } | null;
  subscription: { status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  paymentMethods: Array<{ id: string; type: string; cardNetwork: string | null; lastFour: string | null; upiVpaMasked: string | null; isDefault: boolean }>;
  payments: Array<{ id: string; amount: number; currency: string; status: string; method: string | null; paidAt: string | null }>;
}

function formatAmount(amount: number, currency: string) {
  // Use en-US locale for consistent USD formatting (matching public pricing page),
  // and let Intl.NumberFormat handle the currency symbol based on the currency code
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount / 100);
}

export function billingPeriodLabel(subscription: BillingData["subscription"]) {
  if (!subscription) return null;
  if (subscription.cancelAtPeriodEnd) return "Ends";
  if (["active", "authenticated"].includes(subscription.status)) return "Renews";
  return "Period ended/ends";
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
  const cancelMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/billing/subscription/cancel"),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["/api/billing"] });
      toast({ title: "Subscription cancellation scheduled", description: "Your plan remains active until the end of the billing period." });
    },
    onError: (error: Error) => toast({ title: "Could not cancel subscription", description: error.message, variant: "destructive" }),
  });
  async function startCheckout(planId: string) {
    setCheckoutPending(planId);
    try {
      const order = await (await apiRequest("POST", "/api/billing/checkout/order", { planId })).json();
      await loadRazorpayScript();
      if (!window.Razorpay) throw new Error("Razorpay Checkout is unavailable");
      const checkout = new window.Razorpay({
        key: order.keyId, order_id: order.orderId, amount: order.amount, currency: order.currency,
        name: "TheSocialPundit", description: order.plan.name, prefill: order.prefill,
        theme: { color: color("primary") },
        handler: async (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            await apiRequest("POST", "/api/billing/checkout/verify", {
              razorpayOrderId: response.razorpay_order_id, razorpayPaymentId: response.razorpay_payment_id, razorpaySignature: response.razorpay_signature,
            });
            await cache.invalidateQueries({ queryKey: ["/api/billing"] });
            toast({ title: "Payment successful", description: "Your plan is now active." });
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
  const canCancel = Boolean(subscription && ["active", "authenticated"].includes(subscription.status) && !subscription.cancelAtPeriodEnd);
  const paidPlans = data.plans.filter((plan) => plan.amount > 0);
  const billingStatus = subscription?.cancelAtPeriodEnd ? "Cancellation scheduled" : subscription?.status ?? "No paid subscription";
  return <div className="space-y-6">
    <Card>
      <CardHeader><CardTitle>Billing &amp; Subscription</CardTitle><CardDescription>Manage your plan, payment method, and billing history.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div><p className="text-sm text-muted-foreground">Current plan</p><p className="text-2xl font-semibold">{data.currentPlan?.name ?? "Free"}</p></div>
          <div><p className="text-sm text-muted-foreground">Billing status</p><p className="capitalize">{billingStatus}</p>{subscription?.currentPeriodEnd && <p className="text-sm text-muted-foreground">{billingPeriodLabel(subscription)} {new Date(subscription.currentPeriodEnd).toLocaleDateString()}</p>}</div>
          <p className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4" />Payments via Razorpay</p>
        </div>
        {compact ? <Button asChild className="min-h-11" variant="outline"><Link href="/dashboard/settings?tab=billing">Open Billing</Link></Button> : <>
          {canCancel && <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="text-sm text-muted-foreground">Your access remains active through the current billing period.</p><Button className="min-h-11" variant="outline" disabled={cancelMutation.isPending} onClick={() => { if (window.confirm("Cancel renewal at the end of your current billing period?")) cancelMutation.mutate(); }}>{cancelMutation.isPending ? "Cancelling…" : "Cancel subscription"}</Button></div>}
          {!data.configured && <p className="rounded-md border p-3 text-sm text-muted-foreground">Checkout is currently unavailable. Your existing plan and payment history are shown below.</p>}
        </>}
      </CardContent>
    </Card>
    {!compact && <>
      {paidPlans.length > 0 && <Card><CardHeader><CardTitle>Available plans</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
        {paidPlans.map((plan) => <div key={plan.id} className="rounded-md border p-5"><h3 className="text-lg font-semibold">{plan.name}</h3><p className="text-sm text-muted-foreground">{plan.description}</p><p className="mt-2 text-xl font-semibold">{formatAmount(plan.amount, plan.currency)}<span className="text-sm font-normal">/{plan.interval === "monthly" ? "mo" : plan.interval}</span></p><ul className="my-4 space-y-2">{plan.features.map((feature) => <li key={feature} className="flex gap-2 text-sm"><Check className="h-4 w-4 shrink-0 text-success" />{feature}</li>)}</ul><Button className="min-h-11" disabled={!data.configured || checkoutPending !== null || data.currentPlan?.id === plan.id} onClick={() => startCheckout(plan.id)}>{checkoutPending === plan.id ? "Opening checkout…" : data.currentPlan?.id === plan.id ? "Current plan" : "Upgrade securely"}</Button></div>)}
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