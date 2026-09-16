import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Bull from "bull";

const { storage, publish, assess } = vi.hoisted(() => ({
  storage: { claimPublishTarget: vi.fn(), finishPublishTarget: vi.fn(), getPublishingRule: vi.fn(), getSocialAccountByProvider: vi.fn(), createPublishLog: vi.fn(), getUser: vi.fn() },
  publish: vi.fn(), assess: vi.fn(),
}));
vi.mock("../../storage", () => ({ storage }));
vi.mock("../../services/publishers", () => ({ publishToPlatform: publish }));
vi.mock("../../services/publishers/providerLifecycle", () => ({ assessProviderConnection: assess }));
vi.mock("../../services/email", () => ({ sendAppEmail: vi.fn(), emailTemplates: { postPublished: vi.fn() } }));
import { handlePublishDraft, type PublishDraftJobData } from "./publish-draft";

function job(attemptsMade = 0) {
  return { data: { tenantId: "t", userId: "u", draftId: "d", draftScheduleId: "s", draftScheduleTargetId: "target", platform: "linkedin", publishAt: new Date(0).toISOString(), attemptNumber: 1 },
    opts: { attempts: 3 }, attemptsMade, progress: vi.fn(), discard: vi.fn() } as unknown as Bull.Job<PublishDraftJobData>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("PUBLISHING_MODE", "live");
  storage.claimPublishTarget.mockResolvedValue({ id: "d", content: "hello", platformPublishRules: {}, media: [] });
  storage.finishPublishTarget.mockResolvedValue(true);
  assess.mockReturnValue({ canPublish: true });
  publish.mockResolvedValue({ success: true, postId: "post" });
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
    assess.mockReturnValue({ canPublish: false, reason: "Reconnect account" });
    const task = job();
    await expect(handlePublishDraft(task)).rejects.toThrow("Reconnect account");
    expect(storage.finishPublishTarget).toHaveBeenCalledWith(expect.anything(), "target", "failed", expect.objectContaining({ errorMessage: "Reconnect account" }));
    expect(publish).not.toHaveBeenCalled();
    expect(task.discard).toHaveBeenCalled();
  });

  it.each([0, 1, 2])("uses Bull attemptsMade for pre-send retry %i", async (attempt) => {
    storage.getPublishingRule.mockRejectedValue(new Error("database temporarily unavailable"));
    await expect(handlePublishDraft(job(attempt))).rejects.toThrow("database");
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
});