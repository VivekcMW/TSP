/** Opt-in client experiences backed by `feature_flags` rows. A missing row keeps the default experience. */
export const CLIENT_FEATURE_FLAGS = {
  linkedinInbox: "linkedin_inbox_ui",
  /** Off: Settings → Integrations offers LinkedIn only. Other integrations remain implemented for later. */
  allIntegrations: "all_integrations_ui",
} as const;

/** Integrations offered while the product is LinkedIn-first. */
export const OFFERED_INTEGRATIONS: readonly string[] = ["linkedin"];

export type ClientFeatureName = keyof typeof CLIENT_FEATURE_FLAGS;
export type ClientFeatures = Record<ClientFeatureName, boolean>;

export const DISABLED_CLIENT_FEATURES: ClientFeatures = Object.fromEntries(
  Object.keys(CLIENT_FEATURE_FLAGS).map(name => [name, false]),
) as ClientFeatures;
