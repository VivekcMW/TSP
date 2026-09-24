import { beforeEach, describe, expect, it, vi } from "vitest";

const { suggest } = vi.hoisted(() => ({ suggest: vi.fn() }));
vi.mock("./onboardingSuggestions", async original => ({ ...await original<typeof import("./onboardingSuggestions")>(), suggestOnboardingItems: suggest }));
import { runOnboardingAgent, type AgentEvent, type OnboardingAgentRequest } from "./onboardingAgent";
import { AIGenerationError } from "./openRouter";

const scope = { tenantId: "tenant-a" };
const base = { focusDescription: "I lead marketing for programmatic DOOH in India.", searchEdition: "en-IN" as const, publications: [], topics: [], exclude: [] };
const results = {
  publications: { step: "publications", grounded: true, note: "Trade press first.", picks: ["Media4Growth", "No URL Weekly"], items: [
    { name: "Media4Growth", url: "https://www.media4growth.com/", reason: "OOH trade news" }, { name: "No URL Weekly", url: null, reason: "" }, { name: "Extra", url: null, reason: "" },
  ] },
  topics: { step: "topics", grounded: true, note: "Core topics.", picks: ["Programmatic DOOH", "OOH measurement"], items: [{ name: "Programmatic DOOH", weight: 1 }, { name: "OOH measurement", weight: 0.9 }, { name: "Retail media", weight: 0.4 }] },
  people: { step: "people", grounded: true, note: "Named in the news.", picks: ["Ana Rao", "Vistar Media"], people: [{ name: "Ana Rao", reason: "CEO" }], companies: [{ name: "Vistar Media", reason: "DOOH platform" }] },
};

beforeEach(() => {
  suggest.mockReset().mockImplementation(async (request: { step: keyof typeof results }, _scope: unknown, _signal: unknown, onProgress: (message: string) => void) => {
    onProgress(`working on ${request.step}`);
    return results[request.step];
  });
});

async function run(extra: Partial<OnboardingAgentRequest> & Pick<OnboardingAgentRequest, "steps">) {
  const events: AgentEvent[] = [];
  await runOnboardingAgent({ ...base, ...extra }, scope, new AbortController().signal, event => events.push(event));
  return events;
}

describe("the onboarding agent run", () => {
  it("builds every step in order, reporting progress and carrying its own picks forward", async () => {
    const events = await run({ steps: ["publications", "topics", "people"] });
    expect(events.map(event => event.type === "progress" ? `progress:${event.step}` : event.type === "result" ? `result:${event.step}` : event.type)).toEqual([
      "progress:publications", "result:publications", "progress:topics", "result:topics", "progress:people", "result:people", "done",
    ]);
    expect(events[1]).toEqual({ type: "result", ...results.publications });
    expect(suggest.mock.calls[1][0]).toMatchObject({ step: "topics", publications: [{ name: "Media4Growth", url: "https://www.media4growth.com/" }, { name: "No URL Weekly" }] });
    expect(suggest.mock.calls[2][0]).toMatchObject({ step: "people", topics: ["Programmatic DOOH", "OOH measurement"] });
  });

  it("keeps the user's own selections ahead of the agent's picks when carrying forward", async () => {
    await run({ steps: ["publications", "topics"], publications: [{ name: "My Source", url: "https://mine.test/" }] });
    expect(suggest.mock.calls[1][0].publications).toEqual([{ name: "My Source", url: "https://mine.test/" }, { name: "Media4Growth", url: "https://www.media4growth.com/" }, { name: "No URL Weekly" }]);
  });

  it("redoes a single step with the user's selections and steering instruction", async () => {
    await run({ steps: ["topics"], publications: [{ name: "My Source" }], instruction: "more India-focused", exclude: ["Removed topic"] });
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest.mock.calls[0][0]).toMatchObject({ step: "topics", publications: [{ name: "My Source" }], instruction: "more India-focused", exclude: ["Removed topic"] });
  });

  it("reports a failed step and still runs the steps after it", async () => {
    suggest.mockImplementationOnce(async () => { throw new AIGenerationError("ai_unavailable"); });
    const events = await run({ steps: ["publications", "topics"] });
    expect(events).toContainEqual({ type: "error", step: "publications", code: "ai_unavailable" });
    expect(events.at(-2)).toEqual({ type: "result", ...results.topics });
    expect(suggest.mock.calls[1][0].publications).toEqual([]);
  });

  it("stops when the run is cancelled", async () => {
    const controller = new AbortController();
    suggest.mockImplementationOnce(async () => { controller.abort(new AIGenerationError("ai_cancelled")); throw new AIGenerationError("ai_cancelled"); });
    const events: AgentEvent[] = [];
    await expect(runOnboardingAgent({ ...base, steps: ["publications", "topics"] }, scope, controller.signal, event => events.push(event))).rejects.toBeTruthy();
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(events.some(event => event.type === "done")).toBe(false);
  });
});
