import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, Check, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { useIsSignedIn } from "@/lib/dev-auth";
import { formatPrice, intervalUnit, plansForCurrency, yearlySaving, type PublicBillingPlan } from "@/lib/billing";

const GLOBAL_CURRENCY = "USD";

interface PlanCardProps {
  plan: PublicBillingPlan;
  price: string;
  unit: string;
  eyebrow: string;
  detail?: string;
  badge?: string;
  highlight?: boolean;
  unavailableNote?: string;
  action: { label: string; href: string };
}

function PlanCard({ plan, price, unit, eyebrow, detail, badge, highlight, unavailableNote, action }: PlanCardProps) {
  return (
    <article
      className={`relative flex h-full min-w-0 flex-col overflow-hidden rounded-3xl border bg-card p-6 shadow-sm hover-lift sm:p-7 ${
        highlight ? "border-primary shadow-[0_20px_60px_-32px_hsl(var(--primary)/0.55)] ring-1 ring-primary" : ""
      }`}
      data-testid={`plan-${plan.key}`}
    >
      {highlight && <div className="absolute inset-x-0 top-0 h-1 bg-primary" />}
      <div className="flex min-h-8 items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">{eyebrow}</p>
        {badge && <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">{badge}</span>}
      </div>
      <h2 className="mt-4 font-heading text-2xl font-semibold text-foreground">{plan.name}</h2>
      {plan.description && <p className="mt-2 min-h-10 text-sm leading-6 text-muted-foreground">{plan.description}</p>}
      <p className="mt-7 font-heading text-5xl font-semibold tracking-tight text-foreground">
        {price}<span className="ml-1 text-base font-normal tracking-normal text-muted-foreground">/ {unit}</span>
      </p>
      <p className="mt-2 min-h-5 text-sm font-medium text-muted-foreground">{detail}</p>
      <div className="my-6 h-px bg-border" />
      <ul className="flex-1 space-y-3.5">
        {plan.features.map(feature => (
          <li key={feature} className="flex gap-3 text-sm leading-5 text-foreground">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success-subtle text-success">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            {feature}
          </li>
        ))}
      </ul>
      {unavailableNote && <p className="mt-6 rounded-xl border bg-muted/60 px-4 py-3 text-sm leading-5 text-muted-foreground">{unavailableNote}</p>}
      <Button asChild size="lg" className="mt-6 w-full" variant={highlight ? "default" : "outline"}>
        <Link href={action.href}>{action.label}<ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" /></Link>
      </Button>
    </article>
  );
}

export default function Pricing() {
  const isSignedIn = useIsSignedIn();
  const { data, isPending, isError, refetch } = useQuery<{ plans: PublicBillingPlan[] }>({ queryKey: ["/api/public/billing/plans"] });

  const free = data?.plans.find(plan => plan.amount === 0);
  const paid = data ? plansForCurrency(data.plans, GLOBAL_CURRENCY) : [];
  const monthly = paid.find(plan => plan.interval === "monthly");
  const yearly = paid.find(plan => plan.interval === "annual");
  const saving = monthly && yearly ? yearlySaving(monthly.amount, yearly.amount) : 0;
  const startFree = { label: isSignedIn ? "Go to Dashboard" : "Start free", href: isSignedIn ? "/dashboard" : "/sign-up" };
  const notYet = "Global checkout opens soon.";
  const buy = (plan: PublicBillingPlan) => plan.available === false ? startFree : { label: `Choose ${plan.name}`, href: "/dashboard/settings?tab=billing" };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEO title="Pricing" canonical="/pricing" description="Simple global pricing for TheSocialPundit, billed in US dollars." />
      <SiteHeader />
      <main className="flex-1" data-testid="section-pricing">
        <section className="relative overflow-hidden bg-foreground px-4 py-16 text-background sm:px-6 lg:py-24">
          <div className="pointer-events-none absolute -right-24 -top-40 h-96 w-96 rounded-full bg-primary/35 blur-3xl" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-52 left-1/4 h-96 w-96 rounded-full bg-secondary/20 blur-3xl" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:48px_48px]" aria-hidden="true" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20">
            <Reveal>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary-foreground/70">Pricing built to grow with you</p>
              <h1 className="mt-5 max-w-3xl font-heading text-5xl font-semibold leading-[0.98] tracking-tight text-white sm:text-6xl lg:text-7xl">
                Begin with your voice. Pay when you need momentum.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-white/70">
                Start building your professional authority for free. Upgrade only when you are ready for the complete creation and publishing workflow.
              </p>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-white/90">
                {["No card to start", "You approve every post", "Cancel any time"].map(item => (
                  <span key={item} className="flex items-center gap-2">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-white/10 text-primary-foreground">
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    {item}
                  </span>
                ))}
              </div>
            </Reveal>

            <Reveal delay={0.1}>
            <div className="relative mx-auto w-full max-w-md" aria-label="A simple path from Free to Pro">
              <div className="absolute -inset-5 rounded-[2rem] border border-white/10 bg-white/5" aria-hidden="true" />
              <div className="relative rotate-[-2deg] rounded-3xl border border-white/15 bg-white/10 p-6 shadow-2xl backdrop-blur-md">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/50">Free</p>
                    <p className="mt-1 font-heading text-xl font-semibold text-white">Find your rhythm</p>
                  </div>
                  <span className="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-white/70">Start here</span>
                </div>
                <div className="mt-6 space-y-3">
                  {["Shape your professional voice", "Turn expertise into clear ideas"].map(item => (
                    <div key={item} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/10 px-4 py-3 text-sm text-white/75">
                      <Check className="h-4 w-4 text-primary-foreground" aria-hidden="true" />{item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative -mt-4 ml-6 rotate-[1.5deg] rounded-3xl border border-primary/40 bg-card p-6 text-card-foreground shadow-2xl sm:ml-10">
                <div className="absolute inset-x-6 top-0 h-1 rounded-b-full bg-primary" aria-hidden="true" />
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Pro</p>
                    <p className="mt-1 font-heading text-xl font-semibold">Build momentum</p>
                  </div>
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
                    <Zap className="h-5 w-5" aria-hidden="true" />
                  </span>
                </div>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  {["Create", "Schedule", "Publish", "Measure"].map(item => (
                    <div key={item} className="rounded-xl bg-muted px-3 py-3 text-center text-sm font-semibold">{item}</div>
                  ))}
                </div>
                <p className="mt-5 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <ArrowRight className="h-4 w-4 text-primary" aria-hidden="true" />Upgrade when the workflow earns its place.
                </p>
              </div>
            </div>
            </Reveal>
          </div>
        </section>

        <section className="bg-muted/30 px-4 py-16 sm:px-6 lg:py-24">
          <div className="mx-auto max-w-6xl">
            <Reveal className="mb-10 max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Choose your plan</p>
              <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">A simple path from first post to full momentum.</h2>
              <p className="mt-3 text-muted-foreground">Every plan keeps you in control. Pro adds the complete creation, scheduling, and performance workflow.</p>
            </Reveal>
            {isPending && <p role="status" className="text-center text-muted-foreground">Loading current plans…</p>}
            {(isError || (!isPending && !data?.plans.length)) && (
              <div className="grid overflow-hidden rounded-3xl border bg-card shadow-sm lg:grid-cols-[1fr_auto]">
                <div className="p-7 sm:p-9">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-muted text-muted-foreground"><RefreshCw className="h-5 w-5" aria-hidden="true" /></span>
                  <h2 className="mt-5 font-heading text-2xl font-semibold text-foreground">Current pricing is temporarily unavailable.</h2>
                  <p role="alert" className="mt-2 max-w-2xl leading-7 text-muted-foreground">We could not confirm the live plan catalog, so we are not showing stale prices. You can retry now or start free and choose a paid plan later.</p>
                </div>
                <div className="flex flex-col justify-center gap-3 border-t bg-muted/40 p-7 lg:min-w-64 lg:border-l lg:border-t-0">
                  <Button onClick={() => refetch()}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Retry pricing</Button>
                  <Button asChild variant="outline"><Link href={startFree.href}>{startFree.label}<ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" /></Link></Button>
                </div>
              </div>
            )}
            {!isError && data && data.plans.length > 0 && (
              <StaggerGroup className="grid gap-6 md:grid-cols-3" data-testid="pricing-plans">
                {free && <StaggerItem><PlanCard plan={free} eyebrow="Start here" price={formatPrice(0, GLOBAL_CURRENCY)} unit="month" detail="No card required" action={startFree} /></StaggerItem>}
                {monthly && <StaggerItem><PlanCard plan={monthly} eyebrow="Stay flexible" price={formatPrice(monthly.amount, monthly.currency)} unit={intervalUnit(monthly.interval)}
                  unavailableNote={monthly.available === false ? notYet : undefined} action={buy(monthly)} /></StaggerItem>}
                {yearly && <StaggerItem><PlanCard plan={yearly} eyebrow="Best value" price={formatPrice(yearly.amount, yearly.currency)} unit={intervalUnit(yearly.interval)} highlight
                  detail={`About ${formatPrice(Math.round(yearly.amount / 1200) * 100, yearly.currency)} a month`}
                  badge={saving > 0 ? `Save ${saving}%` : undefined}
                  unavailableNote={yearly.available === false ? notYet : undefined} action={buy(yearly)} /></StaggerItem>}
              </StaggerGroup>
            )}

            <Reveal className="mt-14 grid gap-px overflow-hidden rounded-3xl border bg-border md:grid-cols-2">
              <div className="bg-card p-7">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
                <h2 className="mt-5 font-semibold text-foreground">Secure checkout</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Payments are handled securely by Razorpay. Your payment details are never stored by us.</p>
              </div>
              <div className="bg-card p-7">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><Zap className="h-5 w-5" aria-hidden="true" /></span>
                <h2 className="mt-5 font-semibold text-foreground">No lock-in</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Pay once for a month or year, or subscribe and cancel whenever you like from Billing.</p>
              </div>
            </Reveal>

            <Reveal>
            <p className="mx-auto mt-6 flex max-w-3xl items-start justify-center gap-2 text-center text-sm text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Free plan allowances reset at midnight UTC. Paid access begins only after a successful checkout.
            </p>
            </Reveal>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
