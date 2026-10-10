import { Response } from "node-fetch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { storage, network, lookup } = vi.hoisted(() => ({
  storage: { getPublicationResolutions: vi.fn(), claimPublicationResolution: vi.fn(), completePublicationResolution: vi.fn(), finishPublicationResolution: vi.fn() },
  network: vi.fn(), lookup: vi.fn(),
}));
vi.mock("../storage", () => ({ storage }));
vi.mock("node-fetch", async original => ({ ...await original<typeof import("node-fetch")>(), default: network }));
vi.mock("node:dns/promises", () => ({ default: { lookup } }));
import { resolvePublicationSources } from "./publicationSources";

const scope = { tenantId: "tenant", userId: "user" };
const profile = (url: string) => ({ publications: ["Selected publication"], publicationCandidates: [{ name: "Selected publication", url }] });
const feed = JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: [{ title: "Story", url: "https://news.test/story", content_text: "Article content" }] });
beforeEach(() => {
  vi.resetAllMocks();
  storage.getPublicationResolutions.mockResolvedValue([]);
  storage.claimPublicationResolution.mockResolvedValue("claim-token");
  storage.completePublicationResolution.mockResolvedValue(true);
  storage.finishPublicationResolution.mockResolvedValue(true);
  lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  network.mockImplementation(async () => new Response(feed));
});
afterEach(() => vi.useRealTimers());

describe("publication resolution through real guarded discovery", () => {
  it("claims the candidate then atomically completes the canonical discovered feed", async () => {
    network.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://canonical.test/feed" } }))
      .mockResolvedValueOnce(new Response(feed));
    expect(await resolvePublicationSources(scope, profile("https://news.test/"))).toEqual([]);
    expect(storage.getPublicationResolutions).toHaveBeenCalledWith(scope, ["https://news.test/"]);
    expect(storage.claimPublicationResolution).toHaveBeenCalledWith(scope, "https://news.test/");
    expect(storage.claimPublicationResolution.mock.invocationCallOrder[0]).toBeLessThan(network.mock.invocationCallOrder[0]);
    expect(storage.completePublicationResolution).toHaveBeenCalledWith(scope, "https://news.test/", "claim-token", {
      name: "Selected publication", feedUrl: "https://canonical.test/feed", sourceType: "feed",
    });
    expect(storage.finishPublicationResolution).not.toHaveBeenCalled();
  });

  it.each(["http://127.0.0.1/", "http://2130706433/", "http://169.254.169.254/latest", "http://[::1]/", "http://host.internal/"])("never sends a request or creates a source for %s", async url => {
    const errors = await resolvePublicationSources(scope, profile(url));
    expect(errors).toHaveLength(1);
    expect(network).not.toHaveBeenCalled(); expect(storage.completePublicationResolution).not.toHaveBeenCalled();
    expect(storage.finishPublicationResolution).toHaveBeenCalledWith(scope, new URL(url).href, "claim-token", { status: "failed", error: errors[0] });
    expect(errors[0]).not.toContain(url);
  });

  it.each(["https://user:password@news.test/", "file:///etc/passwd", "javascript:alert(1)"])("rejects invalid candidate metadata before a claim or network request: %s", async url => {
    await expect(resolvePublicationSources(scope, profile(url))).rejects.toThrow();
    expect(storage.claimPublicationResolution).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
    expect(storage.completePublicationResolution).not.toHaveBeenCalled();
  });

  it("rejects DNS resolving to private space", async () => {
    lookup.mockResolvedValue([{ address: "10.0.0.1", family: 4 }]);
    expect(await resolvePublicationSources(scope, profile("https://news.test/"))).toHaveLength(1);
    expect(network).not.toHaveBeenCalled(); expect(storage.completePublicationResolution).not.toHaveBeenCalled();
  });

  it.each(["http://169.254.169.254/latest", "https://user:password@news.test/feed"])("blocks malicious redirects to %s", async location => {
    network.mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
    const errors = await resolvePublicationSources(scope, profile("https://news.test/"));
    expect(errors).toHaveLength(1); expect(errors[0]).not.toContain(location);
    expect(network).toHaveBeenCalledTimes(1); expect(storage.completePublicationResolution).not.toHaveBeenCalled();
    expect(storage.finishPublicationResolution).toHaveBeenCalledWith(scope, "https://news.test/", "claim-token", { status: "failed", error: errors[0] });
  });

  it("does no work when the caller is already cancelled", async () => {
    const controller = new AbortController(); controller.abort();
    expect(await resolvePublicationSources(scope, profile("https://news.test/"), controller.signal)).toEqual([]);
    expect(storage.getPublicationResolutions).not.toHaveBeenCalled(); expect(storage.claimPublicationResolution).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled(); expect(storage.completePublicationResolution).not.toHaveBeenCalled();
  });

  it("cancels during DNS resolution, finishes failed and never makes a late source write", async () => {
    vi.useFakeTimers();
    let release!: (value: unknown) => void;
    lookup.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const controller = new AbortController();
    const task = resolvePublicationSources(scope, profile("https://news.test/"), controller.signal);
    await vi.advanceTimersByTimeAsync(1); controller.abort(new Error("private cancellation detail"));
    expect(await task).toEqual(["The source could not be read. It may be unavailable or block automated access."]);
    release([{ address: "93.184.216.34", family: 4 }]);
    await vi.advanceTimersByTimeAsync(1);
    expect(network).not.toHaveBeenCalled(); expect(storage.completePublicationResolution).not.toHaveBeenCalled();
    expect(storage.finishPublicationResolution).toHaveBeenCalledExactlyOnceWith(scope, "https://news.test/", "claim-token", expect.objectContaining({ status: "failed" }));
  });

  it("propagates completion persistence errors rather than disguising them as discovery failures", async () => {
    const error = new Error("Database unavailable");
    storage.completePublicationResolution.mockRejectedValue(error);
    await expect(resolvePublicationSources(scope, profile("https://news.test/"))).rejects.toMatchObject({
      message: "Could not persist publication source resolution. Please retry.", errors: [error],
    });
    expect(storage.finishPublicationResolution).not.toHaveBeenCalled();
  });
});