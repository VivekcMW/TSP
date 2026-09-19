import { PUBLISHING_PLATFORM_KEYS, publishingCapability, supportedPublishingCapabilities } from "@shared/publishing-capabilities";

export type ProviderExecutionMode = "sandbox" | "dry-run" | "live";

export type ProviderCapability =
  | "publish"
  | "schedule"
  | "analytics"
  | "media"
  | "oauth";

export interface ProviderDefinition {
  key: string;
  label: string;
  aliases: string[];
  authType: "oauth2" | "oauth1" | "apikey" | "webhook" | "manual";
  requiredScopes: string[];
  capabilities: ProviderCapability[];
  enabledByDefault: boolean;
  category: "social" | "blog" | "community" | "dev" | "other";
  notes?: string;
}

export interface ProviderSandboxRequest {
  provider: string;
  content: string;
  mode?: ProviderExecutionMode;
  metadata?: Record<string, unknown>;
}

export interface ProviderSandboxResponse {
  success: boolean;
  provider: string;
  mode: ProviderExecutionMode;
  externalId?: string;
  url?: string;
  status: "simulated" | "failed";
  error?: string;
}

const catalog: ProviderDefinition[] = [
  {
    key: "linkedin",
    label: "LinkedIn",
    aliases: ["linkedin"],
    authType: "oauth2",
    requiredScopes: ["w_member_social"],
    capabilities: ["publish", "schedule", "analytics", "oauth"],
    enabledByDefault: true,
    category: "social",
    notes: "UGC post publishing through LinkedIn API",
  },
  {
    key: "twitter",
    label: "X / Twitter",
    aliases: ["twitter", "x"],
    authType: "oauth2",
    requiredScopes: ["tweet.write", "tweet.read", "users.read"],
    capabilities: ["publish", "schedule", "analytics", "oauth"],
    enabledByDefault: true,
    category: "social",
    notes: "Tweet publishing with OAuth 2.0",
  },
  {
    key: "threads",
    label: "Threads",
    aliases: ["threads"],
    authType: "oauth2",
    requiredScopes: ["threads_basic"],
    capabilities: ["publish", "media"],
    enabledByDefault: false,
    category: "social",
    notes: "Thread-style social publishing",
  },
  {
    key: "bluesky",
    label: "Bluesky",
    aliases: ["bluesky"],
    authType: "apikey",
    requiredScopes: [],
    capabilities: ["publish", "schedule"],
    enabledByDefault: false,
    category: "social",
    notes: "AT Protocol publishing with a Bluesky app password",
  },
  {
    key: "mastodon",
    label: "Mastodon",
    aliases: ["mastodon"],
    authType: "apikey",
    requiredScopes: [],
    capabilities: ["publish", "schedule"],
    enabledByDefault: false,
    category: "social",
    notes: "Federated publishing with a per-instance access token",
  },
  {
    key: "telegram",
    label: "Telegram",
    aliases: ["telegram"],
    authType: "apikey",
    requiredScopes: [],
    capabilities: ["publish"],
    enabledByDefault: false,
    category: "community",
    notes: "Channel/group publishing via a Telegram bot token",
  },
  {
    key: "medium",
    label: "Medium",
    aliases: ["medium"],
    authType: "oauth2",
    requiredScopes: ["basicProfile"],
    capabilities: ["publish", "analytics"],
    enabledByDefault: false,
    category: "blog",
    notes: "Story publishing",
  },
  {
    key: "substack",
    label: "Substack",
    aliases: ["substack"],
    authType: "apikey",
    requiredScopes: ["post.write"],
    capabilities: ["publish"],
    enabledByDefault: false,
    category: "blog",
    notes: "Newsletter publishing",
  },
  {
    key: "devto",
    label: "Dev.to",
    aliases: ["devto", "dev.to"],
    authType: "apikey",
    requiredScopes: ["articles:write"],
    capabilities: ["publish"],
    enabledByDefault: false,
    category: "dev",
    notes: "Developer article publishing",
  },
  {
    key: "hashnode",
    label: "Hashnode",
    aliases: ["hashnode"],
    authType: "apikey",
    requiredScopes: [],
    capabilities: ["publish"],
    enabledByDefault: false,
    category: "dev",
    notes: "Developer blog publishing via a personal access token (Hashnode GraphQL API)",
  },
  {
    key: "reddit",
    label: "Reddit",
    aliases: ["reddit"],
    authType: "oauth2",
    requiredScopes: ["submit", "identity"],
    capabilities: ["publish", "media"],
    enabledByDefault: false,
    category: "community",
    notes: "Community post publishing",
  },
  {
    key: "facebook",
    label: "Facebook",
    aliases: ["facebook"],
    authType: "oauth2",
    requiredScopes: ["pages_manage_posts"],
    capabilities: ["publish", "analytics"],
    enabledByDefault: false,
    category: "social",
    notes: "Page post publishing",
  },
  {
    key: "discord",
    label: "Discord",
    aliases: ["discord"],
    authType: "webhook",
    requiredScopes: [],
    capabilities: ["publish", "media"],
    enabledByDefault: false,
    category: "community",
    notes: "Channel publishing via a user-provided webhook URL",
  },
  { key: "slack", label: "Slack", aliases: ["slack"], authType: "webhook", requiredScopes: [], capabilities: ["publish"], enabledByDefault: false, category: "community", notes: "Channel publishing via incoming webhook" },
];

export const PROVIDER_CATALOG: ProviderDefinition[] = PUBLISHING_PLATFORM_KEYS.map(key => {
  const definition = catalog.find(item => item.key === key);
  return { key, label: key, aliases: [key], requiredScopes: [], enabledByDefault: false, category: "other", ...definition,
    authType: publishingCapability(key)!.auth,
    capabilities: supportedPublishingCapabilities(key) as ProviderCapability[] };
});

export function resolveProviderDefinition(provider: string): ProviderDefinition | undefined {
  const normalized = provider.trim().toLowerCase();

  return PROVIDER_CATALOG.find((candidate) => {
    const aliases = [candidate.key, ...candidate.aliases].map((alias) => alias.trim().toLowerCase());
    return aliases.includes(normalized);
  });
}

export function getProviderExecutionMode(mode?: ProviderExecutionMode): ProviderExecutionMode {
  return mode ?? "sandbox";
}

export async function runProviderSandbox(
  request: ProviderSandboxRequest,
): Promise<ProviderSandboxResponse> {
  const provider = resolveProviderDefinition(request.provider);

  if (!provider) {
    return {
      success: false,
      provider: request.provider,
      mode: getProviderExecutionMode(request.mode),
      status: "failed",
      error: `Provider ${request.provider} is not supported in the sandbox registry`,
    };
  }

  const mode = getProviderExecutionMode(request.mode);

  if (mode === "live") {
    return {
      success: false,
      provider: provider.key,
      mode,
      status: "failed",
      error: `Live mode for ${provider.key} is not enabled until OAuth and env validation are configured`,
    };
  }

  return {
    success: true,
    provider: provider.key,
    mode,
    status: "simulated",
  };
}
