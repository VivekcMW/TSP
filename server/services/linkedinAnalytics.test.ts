import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSocialAccountByProvider, updateSocialAccount, createSocialAnalytics, decryptStoredCredential } = vi.hoisted(() => ({ getSocialAccountByProvider: vi.fn(), updateSocialAccount: vi.fn(), createSocialAnalytics: vi.fn(), decryptStoredCredential: vi.fn() }));
vi.mock("../storage", () => ({ storage: { getSocialAccountByProvider, updateSocialAccount, createSocialAnalytics } }));
vi.mock("./webhookSecrets", () => ({ decryptStoredCredential }));

import { syncLinkedInAnalytics } from "./linkedinAnalytics";

describe("LinkedIn analytics sync", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSocialAccountByProvider.mockResolvedValue({ id: "account", providerAccountId: "member", isActive: true, accessToken: "encrypted", accountName: null, profileImageUrl: null });
    decryptStoredCredential.mockReturnValue("token");
    createSocialAnalytics.mockResolvedValue({ id: "snapshot" });
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("syncs real profile metadata and avoids fabricated engagement metrics", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ sub: "member", name: "Member Name", picture: "https://image.test/profile" }), { status: 200 }));
    await syncLinkedInAnalytics({ tenantId: "tenant", userId: "user" });
    expect(updateSocialAccount).toHaveBeenCalledWith({ tenantId: "tenant", userId: "user" }, "account", expect.objectContaining({ accountName: "Member Name" }));
    expect(createSocialAnalytics).toHaveBeenCalledWith({ tenantId: "tenant", userId: "user" }, expect.objectContaining({ metrics: expect.objectContaining({ impressions: null, engagements: null }), topPosts: null,
      metricAvailability: expect.objectContaining({ impressions: expect.objectContaining({ reason: "unsupported", measuredAt: null, supported: false }) }) }));
    expect(getSocialAccountByProvider).toHaveBeenCalledWith({ tenantId: "tenant", userId: "user" }, "linkedin");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([null, {}, { sub: 123 }, { sub: "" }, { sub: "other-account" }, { sub: "member", name: {} }])("rejects invalid or mismatched provider response %j without writes", async payload => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(payload)));
    await expect(syncLinkedInAnalytics({ tenantId: "tenant", userId: "user" })).rejects.toThrow();
    expect(updateSocialAccount).not.toHaveBeenCalled();
    expect(createSocialAnalytics).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 500])("rejects provider HTTP %s without numeric snapshot", async status => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ sub: "member" }), { status }));
    await expect(syncLinkedInAnalytics({ tenantId: "tenant", userId: "user" })).rejects.toThrow();
    expect(createSocialAnalytics).not.toHaveBeenCalled();
  });
  it.each([undefined, { isActive: false, accessToken: "encrypted" }, { isActive: true, accessToken: null }])("does not fetch without an active connection %j", async account => {
    getSocialAccountByProvider.mockResolvedValue(account);
    await expect(syncLinkedInAnalytics({ tenantId: "tenant", userId: "user" })).rejects.toThrow("not connected");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("ignores metric-looking fields from the identity endpoint", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ sub: "member", followers: 50, impressions: 0, engagements: 99 })));
    await syncLinkedInAnalytics({ tenantId: "tenant", userId: "user" });
    expect(Object.values(createSocialAnalytics.mock.calls[0][1].metrics).every(value => value === null)).toBe(true);
  });
  it("does not write on malformed JSON or network failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("bad json")).mockRejectedValueOnce(new Error("fixture network failure"));
    for (let i = 0; i < 2; i++) await expect(syncLinkedInAnalytics({ tenantId: "tenant", userId: "user" })).rejects.toThrow();
    expect(createSocialAnalytics).not.toHaveBeenCalled();
  });
});
