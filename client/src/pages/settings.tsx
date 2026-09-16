import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Settings, User, Bell, Link2, CreditCard, Check, Loader2, ShieldCheck, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import ProfileSettingsPage from "@/pages/profile-settings";
import type { UserProfile } from "@shared/schema";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
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

interface ConnectionSummary {
  connected: { linkedin: boolean; twitter: boolean };
}

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(amount / 100);
}

function getPlanActionLabel(planId: string, currentPlanId: string | undefined, checkoutPending: string | null): ReactNode {
  if (checkoutPending === planId) return <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Opening checkout…</>;
  if (currentPlanId === planId) return "Current plan";
  return "Upgrade securely";
}

async function loadRazorpayScript() {
  if (window.Razorpay) return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Razorpay Checkout"));
    document.body.appendChild(script);
  });
}

export function BillingPanel({ compact = false }: Readonly<{ compact?: boolean }>) {
  const { data, isLoading, isError } = useQuery<BillingData>({ queryKey: ["/api/billing"] });
  const { toast } = useToast();
  const [checkoutPending, setCheckoutPending] = useState<string | null>(null);
  const orderMutation = useMutation({
    mutationFn: async (planId: string) => (await apiRequest("POST", "/api/billing/checkout/order", { planId })).json(),
  });
  const cancelMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/billing/subscription/cancel"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing"] });
      toast({ title: "Subscription cancellation scheduled", description: "Your plan remains active until the end of the billing period." });
    },
    onError: (error: Error) => toast({ title: "Could not cancel subscription", description: error.message, variant: "destructive" }),
  });

  const startCheckout = async (planId: string) => {
    setCheckoutPending(planId);
    try {
      const order = await orderMutation.mutateAsync(planId);
      await loadRazorpayScript();
      if (!window.Razorpay) throw new Error("Razorpay Checkout is unavailable");
      const checkout = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: "TheSocialPundit",
        description: order.plan.name,
        prefill: order.prefill,
        theme: { color: "#1B2A4A" },
        handler: async (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          await apiRequest("POST", "/api/billing/checkout/verify", {
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
          });
          await queryClient.invalidateQueries({ queryKey: ["/api/billing"] });
          toast({ title: "Payment successful", description: "Your plan is now active." });
        },
        modal: { ondismiss: () => setCheckoutPending(null) },
      });
      checkout.open();
    } catch (error) {
      toast({ title: "Checkout unavailable", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
      setCheckoutPending(null);
    }
  };

  if (isLoading) return <Card><CardContent className="p-8 text-center text-muted-foreground">Loading billing information…</CardContent></Card>;
  if (isError || !data) return <Card><CardContent className="p-8 text-center text-muted-foreground">Billing information is unavailable right now. Please refresh and try again.</CardContent></Card>;
  const paidPlans = data.plans.filter((plan) => plan.amount > 0);
  const canCancel = Boolean(data.subscription && ["active", "authenticated"].includes(data.subscription.status) && !data.subscription.cancelAtPeriodEnd);
  if (compact) return <Card><CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle>Billing &amp; Subscription</CardTitle><CardDescription>Manage your plan and payment history.</CardDescription></div><Link href="/dashboard/billing"><Button variant="outline" size="sm">Open Billing</Button></Link></div></CardHeader><CardContent><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs uppercase tracking-wide text-muted-foreground">Current plan</p><p className="mt-1 text-2xl font-semibold">{data.currentPlan?.name ?? "Free"}</p></div><span className="rounded-full bg-success/10 px-3 py-1 text-xs font-semibold capitalize text-success">{data.subscription?.status ?? "active"}</span></div></CardContent></Card>;

  return <div className="space-y-4">
    <Card className="overflow-hidden border-primary/20">
      <CardHeader className="border-b bg-primary/[0.03] pb-4"><div className="flex items-start justify-between gap-4"><div><CardTitle className="heading-dashboard text-xl">Billing &amp; Subscription</CardTitle><CardDescription className="mt-1">Manage your plan, payment method, and billing history.</CardDescription></div><span className="rounded-full bg-success/10 px-3 py-1 text-xs font-semibold capitalize text-success">{data.subscription?.status ?? "active"}</span></div></CardHeader>
      <CardContent className="p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Current plan</p><p className="mt-1 text-2xl font-semibold">{data.currentPlan?.name ?? "Free"}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Billing status</p><p className="mt-1 text-sm font-medium capitalize">{data.subscription?.cancelAtPeriodEnd ? "Ends at period end" : "Active subscription"}</p>{data.subscription?.currentPeriodEnd && <p className="mt-1 text-xs text-muted-foreground">Renews {new Date(data.subscription.currentPeriodEnd).toLocaleDateString()}</p>}</div>
          <div className="sm:text-right"><p className="text-xs uppercase tracking-wide text-muted-foreground">Payment protection</p><p className="mt-1 flex items-center gap-1.5 text-sm font-medium sm:justify-end"><ShieldCheck className="h-4 w-4 text-success" /> Secured by Razorpay</p></div>
        </div>
        {data.subscription?.cancelAtPeriodEnd && <p className="mt-4 flex items-center gap-2 rounded-[4px] border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"><AlertTriangle className="h-4 w-4 shrink-0" />Cancellation scheduled at period end.</p>}
        {canCancel && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="text-sm text-muted-foreground">Your access remains active through the current billing period.</p><Button variant="outline" disabled={cancelMutation.isPending} onClick={() => { if (window.confirm("Cancel renewal at the end of your current billing period?")) cancelMutation.mutate(); }}>{cancelMutation.isPending ? "Cancelling..." : "Cancel subscription"}</Button></div>}
        {!data.configured && <div className="mt-4 flex items-start gap-2 rounded-[4px] border border-secondary/30 bg-secondary/5 p-3 text-sm"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-secondary" /><p>Razorpay Test Mode is not configured yet. Add the server keys to enable checkout.</p></div>}
      </CardContent>
    </Card>
    {paidPlans.length > 0 && <Card><CardHeader className="pb-4"><CardTitle className="text-lg">Available plans</CardTitle><CardDescription>Upgrade when you are ready to publish more consistently.</CardDescription></CardHeader><CardContent><div className={`grid gap-4 ${paidPlans.length > 1 ? "md:grid-cols-2" : "grid-cols-1"}`}>{paidPlans.map((plan) => <div key={plan.id} className="rounded-[4px] border border-primary/15 bg-background p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-lg font-semibold">{plan.name}</p><p className="mt-1 text-sm text-muted-foreground">{plan.description}</p></div><p className="whitespace-nowrap text-xl font-semibold">{formatAmount(plan.amount, plan.currency)}<span className="text-xs font-normal text-muted-foreground">/{plan.interval === "monthly" ? "mo" : plan.interval}</span></p></div><ul className="mt-5 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">{plan.features.slice(0, 4).map((feature) => <li key={feature} className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-success" />{feature}</li>)}</ul><Button className="mt-5 w-full sm:w-auto" disabled={!data.configured || checkoutPending !== null || data.currentPlan?.id === plan.id} onClick={() => startCheckout(plan.id)}>{getPlanActionLabel(plan.id, data.currentPlan?.id, checkoutPending)}</Button></div>)}</div></CardContent></Card>}
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader className="pb-4"><CardTitle className="text-lg">Payment Method</CardTitle><CardDescription>Only masked payment details are stored.</CardDescription></CardHeader><CardContent>{data.paymentMethods.length ? <div className="space-y-3">{data.paymentMethods.map((method) => <div key={method.id} className="flex items-center justify-between rounded-[4px] border p-3"><div><p className="font-medium capitalize">{method.cardNetwork ? `${method.cardNetwork} •••• ${method.lastFour ?? ""}` : method.upiVpaMasked ?? method.type}</p><p className="text-xs text-muted-foreground">{method.isDefault ? "Default payment method" : "Payment method"}</p></div><ShieldCheck className="h-4 w-4 text-success" /></div>)}</div> : <div className="rounded-[4px] border border-dashed p-4"><p className="text-sm text-muted-foreground">No payment method on file. Choose a paid plan above to add one securely through Razorpay.</p></div>}</CardContent></Card>
      <Card><CardHeader className="pb-4"><CardTitle className="text-lg">Payment History</CardTitle><CardDescription>Your latest billing transactions.</CardDescription></CardHeader><CardContent>{data.payments.length ? <div className="space-y-2">{data.payments.map((payment) => <div key={payment.id} className="flex items-center justify-between gap-3 border-b py-2 last:border-0"><div><p className="text-sm">{payment.paidAt ? new Date(payment.paidAt).toLocaleDateString() : "Processing"} · {payment.method ?? "Payment"}</p><p className="text-xs capitalize text-muted-foreground">{payment.status}</p></div><p className="font-medium">{formatAmount(payment.amount, payment.currency)}</p></div>)}</div> : <p className="text-sm text-muted-foreground">No payments yet.</p>}</CardContent></Card>
    </div>
  </div>;
}

export default function SettingsPage() {
  const requestedContentTab = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "content";
  const [activeTab, setActiveTab] = useState(requestedContentTab ? "content" : "account");
  const [contentSaveAction, setContentSaveAction] = useState<{ onSave: () => void; isPending: boolean } | null>(null);
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: profile } = useQuery<UserProfile>({ queryKey: ["/api/profile"] });
  const { data: connectionSummary } = useQuery<ConnectionSummary>({ queryKey: ["/api/analytics/summary"] });
  const [dailyDigest, setDailyDigest] = useState(true);
  const [contentAlerts, setContentAlerts] = useState(false);
  const [productUpdates, setProductUpdates] = useState(true);

  useEffect(() => {
    if (!profile) return;
    setDailyDigest(profile.dailyDigest ?? true);
    setContentAlerts(profile.contentAlerts ?? false);
    setProductUpdates(profile.productUpdates ?? true);
  }, [profile]);

  const notificationMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", "/api/profile", { dailyDigest, contentAlerts, productUpdates }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      toast({ title: "Notifications saved", description: "Your notification preferences have been updated." });
    },
    onError: () => toast({ title: "Could not save notifications", description: "Please try again.", variant: "destructive" }),
  });

  const primaryEmail = user?.email;
  const initials = user?.firstName && user?.lastName
    ? `${user.firstName[0]}${user.lastName[0]}`
    : primaryEmail?.[0]?.toUpperCase() || "U";

  const handleSave = () => {
    toast({
      title: "Settings saved",
      description: "Your preferences have been updated.",
    });
  };

  const saveNotifications = () => notificationMutation.mutate();
  const linkedInConnected = connectionSummary?.connected.linkedin ?? false;

  let headerAction: ReactNode;
  if (activeTab === "content" && contentSaveAction) {
    headerAction = <Button onClick={contentSaveAction.onSave} disabled={contentSaveAction.isPending} data-testid="button-save-content-preferences"><Check className="mr-2 h-4 w-4" />{contentSaveAction.isPending ? "Saving..." : "Save Content Preferences"}</Button>;
  } else if (activeTab === "account") {
    headerAction = <Button onClick={handleSave} data-testid="button-save-account"><Check className="mr-2 h-4 w-4" />Save Account</Button>;
  } else if (activeTab === "notifications") {
    headerAction = <Button onClick={saveNotifications} disabled={notificationMutation.isPending} data-testid="button-save-notifications"><Check className="mr-2 h-4 w-4" />{notificationMutation.isPending ? "Saving..." : "Save Notifications"}</Button>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="sticky top-0 z-10 bg-background border-b px-6 py-4 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
            <Settings className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold" data-testid="text-page-title">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Manage your account and preferences
            </p>
          </div>
          </div>
          {headerAction}
        </div>
      </header>
      
      <main className="flex-1 p-6 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="mb-6">
              <TabsTrigger value="account" data-testid="tab-account">
                <User className="w-4 h-4 mr-2" />
                Account
              </TabsTrigger>
              <TabsTrigger value="content" data-testid="tab-content-preferences">
                <Settings className="w-4 h-4 mr-2" />
                Content Preferences
              </TabsTrigger>
              <TabsTrigger value="notifications" data-testid="tab-notifications">
                <Bell className="w-4 h-4 mr-2" />
                Notifications
              </TabsTrigger>
              <TabsTrigger value="integrations" data-testid="tab-integrations">
                <Link2 className="w-4 h-4 mr-2" />
                Integrations
              </TabsTrigger>
              <TabsTrigger value="billing" data-testid="tab-billing">
                <CreditCard className="w-4 h-4 mr-2" />
                Billing
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="account">
              <Card>
                <CardHeader>
                  <CardTitle>Profile Information</CardTitle>
                  <CardDescription>Update your account details and public profile.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-20 w-20">
                      <AvatarImage src={user?.imageUrl || undefined} alt={user?.firstName || "User"} />
                      <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
                    </Avatar>
                    <div>
                      <Button variant="outline" size="sm" data-testid="button-change-photo">
                        Change Photo
                      </Button>
                      <p className="text-xs text-muted-foreground mt-1">
                        JPG, PNG or GIF. Max 2MB.
                      </p>
                    </div>
                  </div>
                  
                  <Separator />
                  
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First Name</Label>
                      <Input 
                        id="firstName" 
                        defaultValue={user?.firstName || ""} 
                        data-testid="input-first-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last Name</Label>
                      <Input 
                        id="lastName" 
                        defaultValue={user?.lastName || ""} 
                        data-testid="input-last-name"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input 
                      id="email" 
                      type="email" 
                      defaultValue={primaryEmail || ""} 
                      disabled
                      data-testid="input-email"
                    />
                    <p className="text-xs text-muted-foreground">
                      Email is managed by your authentication provider.
                    </p>
                  </div>
                  
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="content">
              <ProfileSettingsPage embedded onSaveActionChange={setContentSaveAction} />
            </TabsContent>
            
            <TabsContent value="notifications">
              <Card>
                <CardHeader>
                  <CardTitle>Notification Preferences</CardTitle>
                  <CardDescription>Choose what updates you want to receive.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Daily Digest</Label>
                      <p className="text-sm text-muted-foreground">
                        Receive a daily email with your curated content
                      </p>
                    </div>
                    <Switch checked={dailyDigest} onCheckedChange={setDailyDigest} data-testid="switch-daily-digest" />
                  </div>
                  
                  <Separator />
                  
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>New Content Alerts</Label>
                      <p className="text-sm text-muted-foreground">
                        Get notified when high-priority content arrives
                      </p>
                    </div>
                    <Switch checked={contentAlerts} onCheckedChange={setContentAlerts} data-testid="switch-content-alerts" />
                  </div>
                  
                  <Separator />
                  
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Product Updates</Label>
                      <p className="text-sm text-muted-foreground">
                        Learn about new features and improvements
                      </p>
                    </div>
                    <Switch checked={productUpdates} onCheckedChange={setProductUpdates} data-testid="switch-product-updates" />
                  </div>
                  
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="integrations">
              <Card>
                <CardHeader>
                  <CardTitle>Connected Accounts</CardTitle>
                  <CardDescription>Manage your social media connections.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between p-4 border rounded-md">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-md bg-brand-linkedin/10 flex items-center justify-center text-brand-linkedin">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                        </svg>
                      </div>
                      <div>
                        <p className="font-medium">LinkedIn</p>
                        <p className="text-sm text-muted-foreground">{linkedInConnected ? "Connected" : "Not connected"}</p>
                      </div>
                    </div>
                    <Link href="/dashboard/connections"><Button variant="outline" size="sm" data-testid="button-disconnect-linkedin">{linkedInConnected ? "Manage Connection" : "Connect LinkedIn"}</Button></Link>
                  </div>
                  
                  <div className="flex items-center justify-between p-4 border rounded-md">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-md bg-foreground/10 flex items-center justify-center text-foreground">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                        </svg>
                      </div>
                      <div>
                        <p className="font-medium">Twitter/X</p>
                        <p className="text-sm text-muted-foreground">Not connected</p>
                      </div>
                    </div>
                    <Link href="/dashboard/connections"><Button size="sm" data-testid="button-connect-twitter">Manage Connections</Button></Link>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="billing">
              <BillingPanel compact />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
