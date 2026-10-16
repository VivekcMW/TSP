import { resolveProviderDefinition } from "./providerSandbox";
import { publishingCapability } from "@shared/publishing-capabilities";

export type ProviderConnectionStatus = "connected" | "expired" | "missing" | "disabled" | "invalid";

export interface ProviderConnectionSnapshot {
  provider: string;
  isActive?: boolean;
  accessToken?: string | null;
  refreshToken?: string | null;
  scopes?: string[] | null;
  tokenExpiresAt?: Date | string | null;
}

export interface ProviderConnectionAssessment {
  status: ProviderConnectionStatus;
  canPublish: boolean;
  missingScopes: string[];
  requiresRefresh: boolean;
  reason?: string;
}

export function buildPublishSafetyKey(draftId: string, provider: string, tenantId: string): string {
  return ["publish", tenantId, provider, draftId].join(":");
}

export function assessProviderConnection(
  providerKey: string,
  connection: ProviderConnectionSnapshot | null | undefined,
): ProviderConnectionAssessment {
  const provider = resolveProviderDefinition(providerKey);

  if (!provider || !publishingCapability(providerKey)?.live) {
    return {
      status: "invalid",
      canPublish: false,
      missingScopes: [],
      requiresRefresh: false,
      reason: `Provider ${providerKey} is not supported`,
    };
  }

  if (!connection || !connection.isActive) {
    return {
      status: "disabled",
      canPublish: false,
      missingScopes: provider.requiredScopes,
      requiresRefresh: false,
      reason: `${provider.key} is not connected or active`,
    };
  }

  if (!connection.accessToken) {
    return {
      status: "missing",
      canPublish: false,
      missingScopes: provider.requiredScopes,
      requiresRefresh: true,
      reason: `${provider.key} is missing an access token`,
    };
  }

  const requiredScopes = provider.requiredScopes ?? [];
  const currentScopes = connection.scopes ?? [];
  const missingScopes = requiredScopes.filter((scope) => !currentScopes.includes(scope));

  const expiry = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt) : null;
  const isExpired = expiry ? !Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now() : false;

  if (isExpired) {
    return {
      status: "expired",
      canPublish: false,
      missingScopes,
      requiresRefresh: true,
      reason: `${provider.key} token is expired`,
    };
  }

  if (missingScopes.length > 0) {
    return {
      status: "invalid",
      canPublish: false,
      missingScopes,
      requiresRefresh: true,
      reason: `${provider.key} is missing required scopes: ${missingScopes.join(", ")}`,
    };
  }

  return {
    status: "connected",
    canPublish: true,
    missingScopes: [],
    requiresRefresh: false,
  };
}
