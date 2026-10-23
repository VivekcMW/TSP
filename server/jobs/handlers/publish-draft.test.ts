import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Bull from "bull";

const { storage, publish, email, PolicyError } = vi.hoisted(() => ({
  storage: { claimPublishTarget: vi.fn(), finishPublishTarget: vi.fn(), authorizePublishClaim: vi.fn(), getPublishingRule: vi.fn(), getSocialAccountByProvider: vi.fn(), createPublishLog: vi.fn(), getUser: vi.fn() },
  publish: vi.fn(), email: vi.fn(), PolicyError: class PublishingPolicyError extends Error {},
}));
vi.mock("../../storage", () => ({ storage, ScheduleConflictError: class extends Error {} }));
vi.mock("../../services/publishers", () => ({ publishToPlatform: publish }));
vi.mock("../../services/publishing-policy", () => ({ PublishingPolicyError: PolicyError }));
vi.mock("../../services/email", () => ({ sendAppEmail: email, emailTemplates: { postPublished: vi.fn(), postFailed: vi.fn((platform: string, reason: string) => ({ subject: `failed ${platform}`, reason })) } }));
import { handlePublishDraft, type PublishDraftJobData } from "./publish-draft";

function job(attemptsMade = 0) {
  return { data: { tenantId: "t", userId: "u", draftId: "d", draftScheduleId: "s", draftScheduleTargetId: "target", platform: "linkedin", publishAt: new Date(0).toISOString(), attemptNumber: 1 },
    opts: { attempts: 3 }, attemptsMade, progress: vi.fn(), discard: vi.fn() } as unknown as Bull.Job<PublishDraftJobData>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("PUBLISHING_MODE", "live");
  storage.claimPublishTarget.mockResolvedValue({ id: "d", content: "hello", platformPublishRules: {}, media: [], publishClaim: { token: "claim", mode: "live", intent: "publish" } });
  storage.finishPublishTarget.mockResolvedValue(true);
  storage.authorizePublishClaim.mockResolvedValue(undefined);
  publish.mockResolvedValue({ success: true, postId: "post", mode: "live", status: "published", receiptKind: "provider_id" });
});
afterEach(() => vi.unstubAllEnvs());

describe("publish delivery safety", () => {
  it("skips stale/cancelled/missing/already claimed targets before any provider work", async () => {
    storage.claimPublishTarget.mockResolvedValue(undefined);
    expect(await handlePublishDraft(job())).toEqual({ platform: "linkedin", status: "skipped" });
    expect(publish).not.toHaveBeenCalled();
    expect(storage.getPublishingRule).not.toHaveBeenCalled();
    expect(storage.finishPublishTarget).not.toHaveBeenCalled();
  });

  it("commits target completion and log through the aggregate transaction", async () => {
    expect(await handlePublishDraft(job())).toEqual({ platform: "linkedin", status: "published", postId: "post" });
    expect(storage.finishPublishTarget).toHaveBeenCalledWith({ tenantId: "t", userId: "u" }, "target", "published", expect.objectContaining({ draftId: "d", draftScheduleId: "s", platform: "linkedin", publishedPostId: "post" }));
  });

  it("marks disconnected providers failed, never published", async () => {
    storage.authorizePublishClaim.mockRejectedValue(new PolicyError("Reconnect account"));
    const task = job();
    await expect(handlePublishDraft(task)).rejects.toThrow("Reconnect account");
    expect(storage.finishPublishTarget).toHaveBeenCalledWith(expect.anything(), "target", "failed", expect.objectContaining({ errorMessage: "Reconnect account" }));
    expect(publish).not.toHaveBeenCalled();
    expect(task.discard).toHaveBeenCalled();
  });

  it.each([0, 1, 2])("uses Bull attemptsMade for pre-send retry %i", async (attempt) => {
    storage.authorizePublishClaim.mockRejectedValue(new Error("database temporarily unavailable"));
    await expect(handlePublishDraft(job(attempt))).rejects.toThrow("could not be authorized");
    expect(storage.finishPublishTarget).toHaveBeenCalledWith(expect.anything(), "target", attempt < 2 ? "scheduled" : "failed", expect.objectContaining({ attempt: attempt + 1 }));
  });

  it.each(["rejected", "thrown", "missing-id"])("does not replay ambiguous live delivery: %s", async (kind) => {
    if (kind === "thrown") publish.mockRejectedValue(new Error("connection reset"));
    else publish.mockResolvedValue(kind === "missing-id" ? { success: true } : { success: false, error: "response lost" });
    const task = job();
    await expect(handlePublishDraft(task)).rejects.toThrow("reconciliation");
    expect(storage.finishPublishTarget).toHaveBeenCalledWith(expect.anything(), "target", "unknown", expect.anything());
    expect(task.discard).toHaveBeenCalled();
  });

  it("records a known provider ID on DB failure without calling provider again", async () => {
    storage.finishPublishTarget.mockRejectedValueOnce(new Error("commit failed"));
    await expect(handlePublishDraft(job())).rejects.toThrow("reconciliation");
    expect(publish).toHaveBeenCalledTimes(1);
    expect(storage.finishPublishTarget).toHaveBeenLastCalledWith(expect.anything(), "target", "unknown", expect.objectContaining({ publishedPostId: "post" }));
  });

  it("does not turn auxiliary failures after commit into delivery failures", async () => {
    const task = job();
    vi.mocked(task.progress).mockRejectedValue(new Error("redis gone") as never);
    storage.getUser.mockRejectedValue(new Error("email lookup failed"));
    expect((await handlePublishDraft(task)).status).toBe("published");
    expect(storage.finishPublishTarget).toHaveBeenCalledTimes(1);
  });

  it.each(["sandbox", "dry-run"])("records %s without receipt or Published email", async mode => {
    storage.claimPublishTarget.mockResolvedValue({ id: "d", content: "hello", media: [], publishClaim: { token: "claim", mode, intent: "publish" } });
    publish.mockResolvedValue({ success: true, mode, status: "simulated", receiptKind: "none" });
    expect((await handlePublishDraft(job())).status).toBe("simulated");
    expect(storage.finishPublishTarget).toHaveBeenCalledWith(expect.anything(), "target", "simulated", expect.objectContaining({ claimToken: "claim", executionMode: mode, publishedPostId: null }));
    expect(email).not.toHaveBeenCalled();
    expect(storage.getUser).not.toHaveBeenCalled();
  });

  it("keeps Slack acceptance unverified and never sends Published email", async () => {
    publish.mockResolvedValue({ success: true, mode: "live", status: "accepted_unverified", receiptKind: "unavailable" });
    expect((await handlePublishDraft(job())).status).toBe("accepted_unverified");
    expect(email).not.toHaveBeenCalled();
  });

  it("emails the customer once when publishing finally fails, never while a retry is scheduled", async () => {
    storage.getUser.mockResolvedValue({ email: "owner@example.test", name: "Owner" });
    storage.authorizePublishClaim.mockRejectedValue(new PolicyError("Reconnect your LinkedIn account in Settings."));
    await expect(handlePublishDraft(job())).rejects.toThrow("Reconnect");
    expect(email).toHaveBeenCalledTimes(1);
    expect(email).toHaveBeenCalledWith(expect.objectContaining({ type: "post_failed", recipient: "owner@example.test", recipientName: "Owner", userId: "u",
      dedupeKey: "post-failed:target", subject: "failed linkedin", reason: "Reconnect your LinkedIn account in Settings." }));
    email.mockClear();
    storage.authorizePublishClaim.mockRejectedValue(new Error("database temporarily unavailable"));
    await expect(handlePublishDraft(job(0))).rejects.toThrow("could not be authorized");
    expect(email).not.toHaveBeenCalled();
  });

  it("keeps the failure recorded even when the failure email cannot be sent", async () => {
    storage.getUser.mockRejectedValue(new Error("email lookup failed"));
    storage.authorizePublishClaim.mockRejectedValue(new PolicyError("Reconnect account"));
    await expect(handlePublishDraft(job())).rejects.toThrow("Reconnect account");
    expect(storage.finishPublishTarget).toHaveBeenCalledWith(expect.anything(), "target", "failed", expect.anything());
  });

  it("does not notify after a stale completion CAS", async () => {
    storage.finishPublishTarget.mockResolvedValue(false);
    await expect(handlePublishDraft(job())).rejects.toThrow("reconciliation");
    expect(publish).toHaveBeenCalledTimes(1);
    expect(email).not.toHaveBeenCalled();
  });
});