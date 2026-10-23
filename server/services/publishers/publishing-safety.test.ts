import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { adapter } = vi.hoisted(() => ({ adapter: vi.fn() }));
vi.mock("./linkedin", () => ({ publishToLinkedIn: adapter }));
vi.mock("./twitter", () => ({ publishToTwitter: adapter }));
vi.mock("./devto", () => ({ publishToDevTo: adapter }));
vi.mock("./reddit", () => ({ publishToReddit: adapter }));
vi.mock("./bluesky", () => ({ publishToBluesky: adapter }));
vi.mock("./mastodon", () => ({ publishToMastodon: adapter }));
vi.mock("./telegram", () => ({ publishToTelegram: adapter }));
vi.mock("./hashnode", () => ({ publishToHashnode: adapter }));
vi.mock("../webhookPublisher", () => ({ publishToWebhook: adapter }));
import { publishToPlatform } from "./index";
import { DIRECT_PUBLISH_PLATFORMS } from "@shared/publishing-capabilities";
const scope = { tenantId: "t", userId: "u" };
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("PUBLISHING_MODE", "live"); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden"); })); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("adapter receipt boundary", () => {
  it.each(DIRECT_PUBLISH_PLATFORMS)("simulates %s without invoking an adapter even on a live server", async platform => {
    const result = await publishToPlatform(scope, "d", "content", platform);
    expect(result).toMatchObject({ success: true, mode: "sandbox", status: "simulated", receiptKind: "none" });
    expect(result.postId).toBeUndefined(); expect(adapter).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("treats Slack acceptance as unverified without synthesizing an ID", async () => {
    adapter.mockResolvedValue({ success: true });
    const result = await publishToPlatform(scope, "d", "content", "slack", [], "live");
    expect(result).toMatchObject({ status: "accepted_unverified", receiptKind: "unavailable" }); expect(result.postId).toBeUndefined();
  });
  it.each([undefined, "sandbox_fake", "mock_fake", "dryrun_fake"])("rejects missing or synthetic receipt %s", async postId => {
    adapter.mockResolvedValue({ success: true, postId });
    expect(await publishToPlatform(scope, "d", "content", "linkedin", [], "live")).toMatchObject({ success: false, status: "unknown" });
  });
  it("accepts a real provider receipt and sanitizes ambiguous errors", async () => {
    adapter.mockResolvedValueOnce({ success: true, postId: "provider-post" }).mockRejectedValueOnce(new Error("secret credential"));
    expect(await publishToPlatform(scope, "d", "content", "linkedin", [], "live")).toMatchObject({ status: "published", receiptKind: "provider_id", postId: "provider-post" });
    expect(JSON.stringify(await publishToPlatform(scope, "d", "content", "linkedin", [], "live"))).not.toContain("secret");
  });
  it("fails closed when runtime live publishing is disabled", async () => {
    vi.stubEnv("PUBLISHING_MODE", "sandbox");
    expect((await publishToPlatform(scope, "d", "content", "linkedin", [], "live")).success).toBe(false); expect(adapter).not.toHaveBeenCalled();
  });
});