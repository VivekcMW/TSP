import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("../lib/redis", () => ({ redis: undefined }));
vi.mock("./openRouter", async original => ({ ...await original<typeof import("./openRouter")>(), generateTextWithMetadata: generate }));
import { generatePlatformReviewsDetailed } from "./punditBrain";

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe("editorial platform progress", () => {
  it("reports each selected platform once, only after all four tones complete", async () => {
    const sentence = "Desk reports a successful trial in thirty stores.";
    const completed: string[] = [];
    generate.mockImplementation(async () => ({ text: JSON.stringify({ content: sentence, attributions: [{ text: sentence, excerptIds: ["p1"] }] }), provider: "anthropic", model: "mock-model", usage: { inputTokens: 10, outputTokens: 10 }, fallbackUsed: false }));
    const result = await generatePlatformReviewsDetailed({ title: "Pilot", content: sentence, source: "Desk", url: "" }, ["linkedin", "medium"], {
      onPlatformComplete: async platform => { completed.push(platform); expect(generate.mock.calls.length).toBeGreaterThanOrEqual(4); },
    });
    expect(completed).toEqual(["linkedin", "medium"]);
    expect(generate).toHaveBeenCalledTimes(8);
    expect(Object.keys(result.posts.linkedin)).toHaveLength(4);
    expect(Object.keys(result.posts.medium)).toHaveLength(4);
  });

  it.each([undefined, 240_000])("bounds writer time but permits longer queued work (%s)", async timeoutMs => {
    vi.useFakeTimers();
    const sentence = "Desk reports a trial in thirty stores.";
    generate.mockImplementation((_prompt, { signal }: { signal: AbortSignal }) => new Promise((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", cancel);
        resolve({ text: JSON.stringify({ content: sentence, attributions: [{ text: sentence, excerptIds: ["p1"] }] }), provider: "anthropic", model: "mock-model", usage: { inputTokens: 10, outputTokens: 10 }, fallbackUsed: false });
      }, 18_000);
      signal.addEventListener("abort", cancel, { once: true });
    }));
    const generation = generatePlatformReviewsDetailed({ title: "Pilot", content: sentence, source: "Desk", url: "" }, ["linkedin", "medium"], { timeoutMs });
    const assertion = timeoutMs === undefined ? expect(generation).rejects.toMatchObject({ code: "ai_timeout" }) : expect(generation).resolves.toHaveProperty("posts.medium");
    await vi.advanceTimersByTimeAsync(72_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});