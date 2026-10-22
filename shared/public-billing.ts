import { z } from "zod";

export const publicBillingPlanSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  amount: z.number().int().nonnegative(),
  currency: z.string(),
  interval: z.string(),
  features: z.array(z.string()),
  recurringAvailable: z.boolean(),
  available: z.boolean().optional(),
});

export const publicBillingCatalogueSchema = z.object({ plans: z.array(publicBillingPlanSchema) });
export type PublicBillingPlan = z.infer<typeof publicBillingPlanSchema>;
export const PRICING_DATA_ID = "public-pricing-data";

const SITE_URL = "https://www.thesocialpundit.com";
const BILLING_DURATIONS: Record<string, string> = { monthly: "P1M", quarterly: "P3M", annual: "P1Y" };

/**
 * SoftwareApplication structured data offering the plans /pricing shows: the free plan plus the
 * available paid plans in the page's currency. Built from the live catalogue, never hard-coded,
 * so search engines are not shown a price the page no longer charges.
 */
export function pricingOffersJsonLd(plans: PublicBillingPlan[], currency = "USD") {
  const free = plans.find(plan => plan.amount === 0 && plan.available !== false);
  const paid = plans.filter(plan => plan.amount > 0 && plan.currency === currency && plan.available !== false);
  const offers = [
    ...(free ? [{ "@type": "Offer", name: free.name, price: "0", priceCurrency: currency, url: `${SITE_URL}/pricing` }] : []),
    ...paid.map(plan => {
      const price = (plan.amount / 100).toFixed(2);
      return {
        "@type": "Offer",
        name: plan.name,
        price,
        priceCurrency: plan.currency,
        url: `${SITE_URL}/pricing`,
        ...(BILLING_DURATIONS[plan.interval] ? {
          priceSpecification: { "@type": "UnitPriceSpecification", price, priceCurrency: plan.currency, billingDuration: BILLING_DURATIONS[plan.interval] },
        } : {}),
      };
    }),
  ];
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "TheSocialPundit",
    url: `${SITE_URL}/`,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    offers,
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}
