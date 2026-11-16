/** Opt-in client experiences backed by `feature_flags` rows. A missing row keeps the existing experience. */
export const CLIENT_FEATURE_FLAGS = {
  linkedinInbox: "linkedin_inbox_ui",
} as const;

export type ClientFeatureName = keyof typeof CLIENT_FEATURE_FLAGS;
export type ClientFeatures = Record<ClientFeatureName, boolean>;

export const DISABLED_CLIENT_FEATURES: ClientFeatures = Object.fromEntries(
  Object.keys(CLIENT_FEATURE_FLAGS).map(name => [name, false]),
) as ClientFeatures;
