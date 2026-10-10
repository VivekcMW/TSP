import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshProviderAccessToken, validateProviderRuntimeConfig } from "./providerAuth";
import { encryptWebhookUrl } from "../webhookSecrets";

const persist = vi.fn();
const request = { provider: "linkedin", refreshToken: "fake-refresh-token" };
beforeEach(() => {
  vi.stubEnv("WEBHOOK_ENCRYPTION_SECRET", "fake-credential-test-key-at-least-32-characters");
  vi.stubEnv("WEBHOOK_ENCRYPTION_PREVIOUS_SECRETS", "[]");
  for (const provider of ["LINKEDIN", "TWITTER"]) {
    vi.stubEnv(`${provider}_CLIENT_ID`, "fake-client");
    vi.stubEnv(`${provider}_CLIENT_SECRET`, "fake-client-secret");
  }
  persist.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "fake-new-access", expires_in: 123 }))));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("token-free provider refresh", () => {
  it("decrypts input, uses LinkedIn's real endpoint and persists actual expiry before returning", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const result = await refreshProviderAccessToken("linkedin", { ...request, refreshToken: encryptWebhookUrl(request.refreshToken) }, persist);
    expect(fetch).toHaveBeenCalledWith("https://www.linkedin.com/oauth/v2/accessToken", expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }));
    const options = vi.mocked(fetch).mock.calls[0][1]!;
    expect(new URLSearchParams(options.body as string).get("refresh_token")).toBe(request.refreshToken);
    expect(new URLSearchParams(options.body as string).get("client_secret")).toBe("fake-client-secret");
    expect(persist).toHaveBeenCalledWith({ accessToken: "fake-new-access", tokenExpiresAt: new Date(1_800_000_123_000) });
    expect(result).toEqual({ success: true, status: "ok", provider: "linkedin", tokenExpiresAt: new Date(1_800_000_123_000) });
    expect(JSON.stringify(result)).not.toContain("fake-");
  });
  it("normalizes X to Twitter and uses Basic auth rather than invented X environment variables", async () => {
    const result = await refreshProviderAccessToken("x", { provider: "twitter", refreshToken: request.refreshToken }, persist);
    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledWith("https://api.x.com/2/oauth2/token", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Basic " + Buffer.from("fake-client:fake-client-secret").toString("base64") }) }));
    expect(new URLSearchParams(vi.mocked(fetch).mock.calls[0][1]!.body as string).has("client_secret")).toBe(false);
  });
  it("records unknown expiry as null and omits an unrotated refresh token", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ access_token: "fake-new-access" })));
    expect((await refreshProviderAccessToken("linkedin", request, persist)).success).toBe(true);
    expect(persist).toHaveBeenCalledWith({ accessToken: "fake-new-access", tokenExpiresAt: null });
    expect(persist.mock.calls[0][0]).not.toHaveProperty("refreshToken");
  });
  it("passes a rotated refresh token only to persistence", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ access_token: "fake-new-access", refresh_token: "fake-rotated" })));
    const result = await refreshProviderAccessToken("linkedin", request, persist);
    expect(persist).toHaveBeenCalledWith({ accessToken: "fake-new-access", refreshToken: "fake-rotated", tokenExpiresAt: null });
    expect(result).not.toHaveProperty("refreshToken");
    expect(result).not.toHaveProperty("accessToken");
  });
  it.each(["threads", "reddit", "devto", "unknown", "__proto__", "constructor"]) ("fails closed without fetch for unsupported refresh %s", provider => {
    return refreshProviderAccessToken(provider, { provider, refreshToken: "fake" }, persist).then(result => {
      expect(result.status).toBe("unsupported");
      expect(fetch).not.toHaveBeenCalled();
      expect(persist).not.toHaveBeenCalled();
    });
  });
  it.each(["unknown", "__proto__", "constructor", "threads"]) ("never marks unsupported runtime %s enabled", provider => {
    expect(validateProviderRuntimeConfig(provider).enabled).toBe(false);
  });
  it("requires configuration, a matching provider, a token and persistence before networking", async () => {
    expect((await refreshProviderAccessToken("linkedin", request)).success).toBe(false);
    expect((await refreshProviderAccessToken("linkedin", { ...request, provider: "twitter" }, persist)).success).toBe(false);
    expect((await refreshProviderAccessToken("linkedin", { ...request, refreshToken: null }, persist)).status).toBe("missing");
    vi.stubEnv("LINKEDIN_CLIENT_SECRET", "");
    expect((await refreshProviderAccessToken("linkedin", request, persist)).status).toBe("missing");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { access_token: "" }, { access_token: 1 }, { access_token: "enc:v1:forged" },
    { access_token: "fake", refresh_token: null }, { access_token: "fake", refresh_token: " " },
    ...[0, -1, "3600", null, 1e100].map(expires_in => ({ access_token: "fake", expires_in }))])("rejects malformed provider response %j without persistence", async json => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(json)));
    const result = await refreshProviderAccessToken("linkedin", request, persist);
    expect(result.success).toBe(false);
    expect(persist).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("fake");
  });
  it.each([400, 401, 429, 500])("never returns upstream error bodies for HTTP %i", async status => {
    vi.mocked(fetch).mockResolvedValue(new Response("fake-sensitive-upstream", { status }));
    const result = await refreshProviderAccessToken("linkedin", request, persist);
    expect(result.status).toBe(status === 400 || status === 401 ? "expired" : "failed");
    expect(JSON.stringify(result)).not.toContain("fake-sensitive");
    expect(persist).not.toHaveBeenCalled();
  });
  it("hides transport, JSON and persistence exceptions", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("fake-secret-in-network-error"));
    expect(JSON.stringify(await refreshProviderAccessToken("linkedin", request, persist))).not.toContain("fake-secret");
    vi.mocked(fetch).mockResolvedValueOnce(new Response("not-json-fake-secret"));
    expect((await refreshProviderAccessToken("linkedin", request, persist)).success).toBe(false);
    persist.mockRejectedValueOnce(new Error("fake-secret-in-sql"));
    const result = await refreshProviderAccessToken("linkedin", request, persist);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain("fake-secret");
  });
  it.each(["enc:v2:bad", " "]) ("does not send invalid stored credentials %s", async refreshToken => {
    expect((await refreshProviderAccessToken("linkedin", { ...request, refreshToken }, persist)).success).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});