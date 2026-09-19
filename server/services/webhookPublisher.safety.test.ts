import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { account, decrypt } = vi.hoisted(() => ({ account: vi.fn(), decrypt: vi.fn() }));
vi.mock("../storage", () => ({ storage: { getSocialAccountByProvider: account } }));
vi.mock("./webhookSecrets", () => ({ decryptWebhookUrl: decrypt }));
vi.mock("./mediaStorage", () => ({ readMedia: vi.fn() }));
import { publishToWebhook, isValidWebhookUrl } from "./webhookPublisher";
const scope = { tenantId: "t", userId: "u" };
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("PUBLISHING_MODE", "live"); account.mockResolvedValue({ accessToken: "encrypted" }); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("webhook delivery honesty", () => {
  it("does not fabricate a Slack ID for its plain ok response", async () => {
    decrypt.mockReturnValue("https://hooks.slack.com/services/T/B/test");
    vi.mocked(fetch).mockResolvedValue(new Response("ok"));
    const result = await publishToWebhook("slack", scope, "hello");
    expect(result).toEqual({ success: true, status: "accepted_unverified" });
    expect(fetch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }));
  });
  it("requires a genuine Discord message ID", async () => {
    decrypt.mockReturnValue("https://discord.com/api/webhooks/123/token");
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}")).mockResolvedValueOnce(new Response(JSON.stringify({ id: "message", channel_id: "channel" })));
    expect((await publishToWebhook("discord", scope, "hello")).success).toBe(false);
    expect(await publishToWebhook("discord", scope, "hello")).toMatchObject({ success: true, postId: "message" });
  });
  it("simulates without looking up credentials or making requests", async () => {
    vi.stubEnv("PUBLISHING_MODE", "sandbox");
    expect(await publishToWebhook("slack", scope, "hello")).toEqual({ success: true, status: "simulated" });
    expect(account).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects invalid stored endpoints and hides raw exceptions", async () => {
    expect(isValidWebhookUrl("discord", "https://discord.com/api/webhooks/123/token?redirect=other")).toBe(false);
    decrypt.mockImplementation(() => { throw new Error("secret credentials"); });
    expect(JSON.stringify(await publishToWebhook("discord", scope, "hello"))).not.toContain("secret");
    expect(fetch).not.toHaveBeenCalled();
  });
});