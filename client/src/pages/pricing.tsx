import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { formatBillingAmount, type PublicBillingPlan } from "@/lib/billing";

export default function Pricing() {
  const { data, isPending, isError, refetch } = useQuery<{ plans: PublicBillingPlan[] }>({ queryKey: ["/api/public/billing/plans"] });
  return <div className="flex min-h-screen flex-col bg-background">
    <SEO title="Pricing" canonical="/pricing" description="Explore the current TheSocialPundit plan catalog and choose the access you need." />
    <SiteHeader />
    <main className="flex-1 px-4 py-20 sm:px-6" data-testid="section-pricing">
      <div className="mx-auto max-w-5xl space-y-10">
        <div className="text-center"><h1 className="heading-display mb-4">Choose your plan</h1><p className="text-muted-foreground">Current catalog pricing. No automatic renewal with a one-time purchase.</p></div>
        {isPending && <p role="status">Loading current plans…</p>}
        {(isError || (!isPending && !data?.plans.length)) && <Card><CardContent className="space-y-4 p-6"><p role="alert">The plan catalog is unavailable. No prices or access promises can be confirmed right now.</p><Button variant="outline" onClick={() => refetch()}>Retry</Button></CardContent></Card>}
        {!isError && <div className="grid gap-6 md:grid-cols-2">{data?.plans.map(plan => <Card key={plan.id}>
          <CardHeader><CardTitle>{plan.name}</CardTitle><p className="text-muted-foreground">{plan.description}</p></CardHeader>
          <CardContent className="space-y-6"><p className="text-3xl font-semibold">{formatBillingAmount(plan.amount, plan.currency)}<span className="text-sm font-normal text-muted-foreground"> / {plan.interval} interval</span></p>
            <ul className="space-y-3">{plan.features.map(feature => <li key={feature} className="flex gap-2 text-sm"><Check className="h-4 w-4 shrink-0 text-success" />{feature}</li>)}</ul>
            <Button asChild className="min-h-11 w-full"><Link href={plan.amount === 0 ? "/sign-up" : "/dashboard/settings?tab=billing"}>{plan.amount === 0 ? "Create an account" : "View checkout options"}</Link></Button>
          </CardContent>
        </Card>)}</div>}
        <p className="text-sm text-muted-foreground">Generation allowances count bounded attempts, including failures after reservation. Free allowances reset at midnight UTC. Recurring checkout is offered only for configured provider plans; choose the number of billing cycles explicitly at checkout.</p>
      </div>
    </main>
    <SiteFooter />
  </div>;
}
