import { afterEach, describe, expect, it } from "vitest";
import { validateProviderRuntimeConfig, refreshProviderAccessToken } from "./providerAuth";

describe("provider auth runtime config", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("accepts a configured provider when the required env vars are present", () => {
    process.env.LINKEDIN_CLIENT_ID = "client-id";
    process.env.LINKEDIN_CLIENT_SECRET = "client-secret";
    process.env.LINKEDIN_REDIRECT_URI = "https://example.com/callback";

    const result = validateProviderRuntimeConfig("linkedin");
    expect(result.enabled).toBe(true);
    expect(result.missingEnvVars).toHaveLength(0);
  });

  it("flags missing env vars for a provider that has not been configured", () => {
    const result = validateProviderRuntimeConfig("twitter");
    expect(result.enabled).toBe(false);
    expect(result.missingEnvVars.length).toBeGreaterThan(0);
  });

  it("returns a clear result when no refresh token is available", async () => {
    process.env.LINKEDIN_CLIENT_ID = "client-id";
    process.env.LINKEDIN_CLIENT_SECRET = "client-secret";
    process.env.LINKEDIN_REDIRECT_URI = "https://example.com/callback";

    const result = await refreshProviderAccessToken("linkedin", {
      provider: "linkedin",
      accessToken: "abc",
      refreshToken: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("missing");
  });
});
