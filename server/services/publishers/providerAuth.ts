import { decryptStoredCredential } from "../webhookSecrets";

export interface ProviderRuntimeConfigResult {
  provider: string;
  enabled: boolean;
  missingEnvVars: string[];
  requiredEnvVars: string[];
}

export interface ProviderRefreshRequest {
  provider: string;
  accessToken?: string | null;
  refreshToken?: string | null;
}

export interface ProviderRefreshResult {
  success: boolean;
  status: "ok" | "missing" | "expired" | "failed";
  provider: string;
  accessToken?: string;
  refreshToken?: string;
  reason?: string;
}

const providerEnvMap: Record<string, string[]> = {
  linkedin: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LINKEDIN_REDIRECT_URI"],
  twitter: ["TWITTER_CLIENT_ID", "TWITTER_CLIENT_SECRET", "TWITTER_REDIRECT_URI"],
  x: ["TWITTER_CLIENT_ID", "TWITTER_CLIENT_SECRET", "TWITTER_REDIRECT_URI"],
  threads: ["THREADS_CLIENT_ID", "THREADS_CLIENT_SECRET", "THREADS_REDIRECT_URI"],
};

export function validateProviderRuntimeConfig(provider: string): ProviderRuntimeConfigResult {
  const normalized = provider.trim().toLowerCase();
  const requiredEnvVars = providerEnvMap[normalized] ?? [];
  const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);

  return {
    provider: normalized,
    enabled: missingEnvVars.length === 0,
    missingEnvVars,
    requiredEnvVars,
  };
}

export async function refreshProviderAccessToken(
  provider: string,
  request: ProviderRefreshRequest,
): Promise<ProviderRefreshResult> {
  const normalized = provider.trim().toLowerCase();
  const config = validateProviderRuntimeConfig(normalized);

  if (!config.enabled) {
    return {
      success: false,
      status: "missing",
      provider: normalized,
      reason: `Missing runtime configuration for ${normalized}: ${config.missingEnvVars.join(", ")}`,
    };
  }

  if (!request.refreshToken) {
    return {
      success: false,
      status: "missing",
      provider: normalized,
      reason: `No refresh token available for ${normalized}`,
    };
  }

  try {
    const tokenEndpoint =
      normalized === "linkedin"
        ? "https://www.linkedin.com/oauth/v2/accessToken"
        : normalized === "twitter" || normalized === "x"
          ? "https://api.twitter.com/2/oauth2/token"
          : "https://example.com/token";

    const refreshResponse = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: decryptStoredCredential(request.refreshToken),
        client_id: process.env[`${normalized.toUpperCase()}_CLIENT_ID`] || "",
        client_secret: process.env[`${normalized.toUpperCase()}_CLIENT_SECRET`] || "",
      }).toString(),
    });

    if (!refreshResponse.ok) {
      return {
        success: false,
        status: "failed",
        provider: normalized,
        reason: `Refresh request failed with HTTP ${refreshResponse.status}`,
      };
    }

    const json = (await refreshResponse.json()) as {
      access_token?: string;
      refresh_token?: string;
    };

    return {
      success: true,
      status: "ok",
      provider: normalized,
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? request.refreshToken,
    };
  } catch (error) {
    return {
      success: false,
      status: "failed",
      provider: normalized,
      reason: error instanceof Error ? error.message : "Unknown refresh error",
    };
  }
}
