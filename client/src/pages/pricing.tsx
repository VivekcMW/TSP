import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Check, Globe2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { useIsSignedIn } from "@/lib/dev-auth";
import { formatPrice, intervalUnit, plansForCurrency, yearlySaving, type PublicBillingPlan } from "@/lib/billing";
import { COUNTRIES, currencyForCountry, type PricingCurrency } from "@/lib/pricing-country";
import { usePricingCountry } from "@/lib/use-pricing-country";

const CURRENCY_NAMES: Record<PricingCurrency, string> = { INR: "Indian rupees", USD: "US dollars" };
const CURRENCY_SYMBOLS: Record<PricingCurrency, string> = { INR: "₹", USD: "$" };

interface PlanCardProps {
  plan: PublicBillingPlan;
  price: string;
  unit: string;
  detail?: string;
  badge?: string;
  highlight?: boolean;
  unavailableNote?: string;
  action: { label: string; href: string };
}

function PlanCard({ plan, price, unit, detail, badge, highlight, unavailableNote, action }: PlanCardProps) {
  return (
    <article className={`flex flex-col rounded-2xl border bg-card p-7 ${highlight ? "border-2 border-primary shadow-lg" : ""}`} data-testid={`plan-${plan.key}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-foreground">{plan.name}</h2>
        {badge && <span className="rounded-full bg-secondary px-3 py-1 text-xs font-bold text-secondary-foreground">{badge}</span>}
      </div>
      {plan.description && <p className="mt-2 text-sm text-muted-foreground">{plan.description}</p>}
      <p className="mt-6 font-heading text-4xl font-semibold text-foreground">
        {price}<span className="ml-1 text-base font-normal text-muted-foreground">/ {unit}</span>
      </p>
      <p className="mt-1 min-h-5 text-sm text-muted-foreground">{detail}</p>
      <ul className="my-6 flex-1 space-y-3">
        {plan.features.map(feature => (
          <li key={feature} className="flex gap-2 text-sm text-foreground"><Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />{feature}</li>
        ))}
      </ul>
      {unavailableNote && <p className="mb-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{unavailableNote}</p>}
      <Button asChild size="lg" className="self-start" variant={highlight ? "default" : "outline"}>
        <Link href={action.href}>{action.label}</Link>
      </Button>
    </article>
  );
}

export default function Pricing() {
  const isSignedIn = useIsSignedIn();
  const [country, setCountry] = usePricingCountry();
  const currency = currencyForCountry(country);
  const { data, isPending, isError, refetch } = useQuery<{ plans: PublicBillingPlan[] }>({ queryKey: ["/api/public/billing/plans"] });

  const free = data?.plans.find(plan => plan.amount === 0);
  const paid = data ? plansForCurrency(data.plans, currency) : [];
  const monthly = paid.find(plan => plan.interval === "monthly");
  const yearly = paid.find(plan => plan.interval === "annual");
  const saving = monthly && yearly ? yearlySaving(monthly.amount, yearly.amount) : 0;
  const startFree = { label: isSignedIn ? "Go to Dashboard" : "Start free", href: isSignedIn ? "/dashboard" : "/sign-up" };
  const notYet = `Paying in ${CURRENCY_NAMES[currency]} opens soon.`;
  const buy = (plan: PublicBillingPlan) => plan.available === false ? startFree : { label: `Choose ${plan.name}`, href: "/dashboard/settings?tab=billing" };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEO title="Pricing" canonical="/pricing" description="TheSocialPundit pricing in your currency: rupees for India, US dollars everywhere else." />
      <SiteHeader />
      <main className="flex-1" data-testid="section-pricing">
        <section className="border-b bg-card px-4 pb-12 pt-16 sm:px-6 lg:pt-20">
          <div className="mx-auto max-w-3xl space-y-6 text-center">
            <p className="text-xs font-bold uppercase tracking-wider text-secondary-text">Pricing</p>
            <h1 className="heading-display text-foreground">Simple pricing, wherever you are</h1>
            <p className="text-lg text-muted-foreground">Choose your country to see prices in your currency.</p>
            <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-left">
              <SearchableSelect
                label={<><Globe2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Prices for</>}
                labelClassName="flex items-center justify-center gap-2 text-sm font-semibold text-foreground"
                value={country} options={COUNTRIES} onChange={setCountry}
                searchPlaceholder="Search countries" emptyMessage="No country found."
              />
              <p className="text-sm text-muted-foreground">Prices in {CURRENCY_NAMES[currency]} ({CURRENCY_SYMBOLS[currency]})</p>
            </div>
          </div>
        </section>

        <section className="px-4 py-14 sm:px-6">
          <div className="mx-auto max-w-6xl space-y-10">
            {isPending && <p role="status" className="text-center text-muted-foreground">Loading current plans…</p>}
            {(isError || (!isPending && !data?.plans.length)) && (
              <div className="mx-auto max-w-xl space-y-4 rounded-2xl border bg-card p-6 text-center">
                <p role="alert">The plan catalog is unavailable. No prices or access promises can be confirmed right now.</p>
                <Button variant="outline" onClick={() => refetch()}>Retry</Button>
              </div>
            )}
            {!isError && data && data.plans.length > 0 && (
              <div className="grid gap-6 md:grid-cols-3" data-testid="pricing-plans">
                {free && <PlanCard plan={free} price={formatPrice(0, currency)} unit="month" action={startFree} />}
                {monthly && <PlanCard plan={monthly} price={formatPrice(monthly.amount, monthly.currency)} unit={intervalUnit(monthly.interval)}
                  unavailableNote={monthly.available === false ? notYet : undefined} action={buy(monthly)} />}
                {yearly && <PlanCard plan={yearly} price={formatPrice(yearly.amount, yearly.currency)} unit={intervalUnit(yearly.interval)} highlight
                  detail={`About ${formatPrice(Math.round(yearly.amount / 1200) * 100, yearly.currency)} a month`}
                  badge={saving > 0 ? `Save ${saving}%` : undefined}
                  unavailableNote={yearly.available === false ? notYet : undefined} action={buy(yearly)} />}
              </div>
            )}

            <div className="grid gap-6 rounded-2xl border bg-card p-7 md:grid-cols-3">
              <div className="space-y-2">
                <h2 className="font-semibold text-foreground">Which currency will I pay in?</h2>
                <p className="text-sm text-muted-foreground">Rupees if you choose India, US dollars for every other country.</p>
              </div>
              <div className="space-y-2">
                <h2 className="font-semibold text-foreground">Can I change my country?</h2>
                <p className="text-sm text-muted-foreground">Yes. Pick another country above; we remember your choice on this device.</p>
              </div>
              <div className="space-y-2">
                <h2 className="font-semibold text-foreground">Can I cancel?</h2>
                <p className="text-sm text-muted-foreground">Yes. A one-time payment covers one month or year and doesn't renew; a subscription can be cancelled any time in Billing.</p>
              </div>
            </div>

            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Pay for one month or year at a time, or subscribe and cancel whenever you like. Payments are handled securely by Razorpay.
              Free plan allowances reset at midnight UTC.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
