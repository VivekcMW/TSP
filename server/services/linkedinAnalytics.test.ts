import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSocialAccountByProvider, updateSocialAccount, createSocialAnalytics, decryptStoredCredential } = vi.hoisted(() => ({ getSocialAccountByProvider: vi.fn(), updateSocialAccount: vi.fn(), createSocialAnalytics: vi.fn(), decryptStoredCredential: vi.fn() }));
vi.mock("../storage", () => ({ storage: { getSocialAccountByProvider, updateSocialAccount, createSocialAnalytics } }));
vi.mock("./webhookSecrets", () => ({ decryptStoredCredential }));

import { syncLinkedInAnalytics } from "./linkedinAnalytics";

describe("LinkedIn analytics sync", () => {
  beforeEach(() => {
    getSocialAccountByProvider.mockResolvedValue({ id: "account", accessToken: "encrypted", accountName: null, profileImageUrl: null });
    decryptStoredCredential.mockReturnValue("token");
    createSocialAnalytics.mockResolvedValue({ id: "snapshot" });
    vi.stubGlobal("fetch", vi.fn());
  });

  it("syncs real profile metadata and avoids fabricated engagement metrics", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ sub: "member", name: "Member Name", picture: "https://image.test/profile" }), { status: 200 }));
    await syncLinkedInAnalytics({ tenantId: "tenant", userId: "user" });
    expect(updateSocialAccount).toHaveBeenCalledWith({ tenantId: "tenant", userId: "user" }, "account", expect.objectContaining({ accountName: "Member Name" }));
    expect(createSocialAnalytics).toHaveBeenCalledWith({ tenantId: "tenant", userId: "user" }, expect.objectContaining({ metrics: expect.objectContaining({ impressions: 0, engagements: 0 }) }));
  });
});
