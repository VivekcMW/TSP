import { z } from "zod";
import { unavailableAnalytics } from "@shared/analytics-availability";

// OIDC identity fields only. Unexpected audience/engagement-looking fields are ignored.
const profileSchema = z.object({
  sub: z.string().trim().min(1).max(300),
  name: z.string().max(500).optional(),
  given_name: z.string().max(250).optional(),
  family_name: z.string().max(250).optional(),
  email: z.string().email().optional(),
  picture: z.string().url().optional(),
});

export function parseLinkedInAnalyticsProfile(value: unknown) {
  const parsed = profileSchema.safeParse(value);
  if (!parsed.success) throw new Error("LinkedIn returned an invalid profile response");
  return parsed.data;
}

export function linkedInProfileOnlySnapshot(socialAccountId: string, snapshotDate = new Date()) {
  const { metrics, availability } = unavailableAnalytics("unsupported");
  return { socialAccountId, provider: "linkedin", snapshotDate, metrics, metricAvailability: availability, topPosts: null };
}