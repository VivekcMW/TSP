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
