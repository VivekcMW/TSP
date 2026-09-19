import { decryptStoredCredential } from "../webhookSecrets";
import { z } from "zod";

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
  status: "ok" | "missing" | "expired" | "failed" | "unsupported";
  provider: string;
  tokenExpiresAt?: Date | null;
  reason?: string;
}

/** Internal persistence payload. Never returned by refresh or serialized to HTTP. */
export interface RefreshedCredentials {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt: Date | null;
}

const providerEnvMap: Record<string, string[]> = {
  linkedin: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  twitter: ["TWITTER_CLIENT_ID", "TWITTER_CLIENT_SECRET"],
  reddit: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
  devto: [], hashnode: [], mastodon: [], bluesky: [], telegram: [], discord: [], slack: [],
};
const normalize = (provider: string) => provider.trim().toLowerCase() === "x" ? "twitter" : provider.trim().toLowerCase();

export function validateProviderRuntimeConfig(provider: string): ProviderRuntimeConfigResult {
  const normalized = normalize(provider);
  const supported = Object.hasOwn(providerEnvMap, normalized);
  const requiredEnvVars = supported ? providerEnvMap[normalized] : [];
  const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]?.trim());

  return {
    provider: normalized,
    enabled: supported && missingEnvVars.length === 0,
    missingEnvVars,
    requiredEnvVars,
  };
}

const issuedTokenSchema = z.string().trim().min(1).refine(value => !value.startsWith("enc:"));
const refreshResponseSchema = z.object({
  access_token: issuedTokenSchema,
  refresh_token: issuedTokenSchema.optional(),
  expires_in: z.number().finite().positive().optional(),
});

function refreshedCredentials(json: unknown, startedAt: number): RefreshedCredentials {
  const token = refreshResponseSchema.parse(json);
  const tokenExpiresAt = token.expires_in === undefined ? null : new Date(startedAt + token.expires_in * 1000);
  if (tokenExpiresAt && (!Number.isFinite(tokenExpiresAt.getTime()) || tokenExpiresAt.getTime() <= Date.now())) {
    throw new Error("Invalid provider expiry");
  }
  return { accessToken: token.access_token, ...(token.refresh_token === undefined ? {} : { refreshToken: token.refresh_token }), tokenExpiresAt };
}

export async function refreshProviderAccessToken(
  provider: string,
  request: ProviderRefreshRequest,
  persist?: (credentials: RefreshedCredentials) => Promise<void>,
): Promise<ProviderRefreshResult> {
  const normalized = normalize(provider);
  const fail = (status: ProviderRefreshResult["status"], reason: string): ProviderRefreshResult => ({ success: false, status, provider: normalized, reason });
  if (!["linkedin", "twitter"].includes(normalized)) return fail("unsupported", "Token refresh is not supported; reconnect using the provider flow");
  if (normalize(request.provider) !== normalized) return fail("failed", "Provider mismatch");
  if (!validateProviderRuntimeConfig(normalized).enabled) return fail("missing", "Provider runtime configuration is missing");
  if (!request.refreshToken) return fail("missing", "No refresh token available; reconnect the provider");
  if (!persist) return fail("failed", "Credential persistence is required");

  try {
    const envPrefix = normalized === "twitter" ? "TWITTER" : "LINKEDIN";
    const clientId = process.env[`${envPrefix}_CLIENT_ID`]!;
    const clientSecret = process.env[`${envPrefix}_CLIENT_SECRET`]!;
    const refreshToken = issuedTokenSchema.parse(decryptStoredCredential(request.refreshToken));
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    if (normalized === "twitter") {
      headers.Authorization = "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    } else {
      body.set("client_id", clientId);
      body.set("client_secret", clientSecret);
    }
    const startedAt = Date.now();
    const response = await fetch(normalized === "linkedin" ? "https://www.linkedin.com/oauth/v2/accessToken" : "https://api.x.com/2/oauth2/token", {
      method: "POST", headers, body: body.toString(), redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return fail(response.status === 400 || response.status === 401 ? "expired" : "failed", "Provider rejected token refresh; reconnect or try again later");
    const credentials = refreshedCredentials(await response.json(), startedAt);
    await persist(credentials);
    return { success: true, status: "ok", provider: normalized, tokenExpiresAt: credentials.tokenExpiresAt };
  } catch {
    return fail("failed", "Could not refresh and store provider credentials");
  }
}
