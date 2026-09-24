import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("../lib/redis", () => ({ redis: undefined }));
vi.mock("./openRouter", async original => ({ ...await original<typeof import("./openRouter")>(), generateText }));
import { clearOnboardingCache } from "./onboardingShared";
import { understandFocus } from "./onboardingUnderstanding";
import { AIGenerationError } from "./openRouter";

const scope = { tenantId: "tenant-a" };
const focus = "I lead marketing at an out-of-home advertising company focused on programmatic DOOH in India.";
const reply = (value: unknown) => generateText.mockResolvedValue(JSON.stringify(value));

beforeEach(() => { vi.resetAllMocks(); clearOnboardingCache(); });

describe("understanding the user's focus", () => {
  it("returns a trimmed, bounded summary and drops empty or duplicate focus areas", async () => {
    reply({ role: " Head of Marketing ", industry: "Out-of-home advertising", focusAreas: ["Programmatic DOOH", " ", "programmatic dooh", "Measurement", "Retail media", "Transit media", "Creative", "Extra"], region: "India", audience: "Agencies and brands", question: null });
    expect(await understandFocus({ focusDescription: focus }, scope)).toEqual({
      role: "Head of Marketing", industry: "Out-of-home advertising", focusAreas: ["Programmatic DOOH", "Measurement", "Retail media", "Transit media", "Creative"],
      region: "India", audience: "Agencies and brands", question: null,
    });
  });

  it("asks the model's follow-up question when the focus is vague, with at most four answers", async () => {
    reply({ role: "Marketer", industry: "Advertising", focusAreas: ["Marketing"], region: null, audience: null, question: { text: "Which region do you mainly cover?", options: ["India", "Asia-Pacific", "Global", "Europe", "USA"] } });
    const result = await understandFocus({ focusDescription: "I work in marketing and advertising." }, scope);
    expect(result.question).toEqual({ text: "Which region do you mainly cover?", options: ["India", "Asia-Pacific", "Global", "Europe"] });
    expect(result.region).toBeNull();
  });

  it("sends the clarification to the model and never asks again after one", async () => {
    reply({ role: "Marketer", industry: "Advertising", focusAreas: ["DOOH"], region: "India", audience: null, question: { text: "Another question?", options: ["A", "B"] } });
    const result = await understandFocus({ focusDescription: "I work in marketing and advertising.", clarification: { question: "Which region do you mainly cover?", answer: "India" } }, scope);
    expect(result.question).toBeNull();
    expect(generateText.mock.calls[0][0]).toContain('"answer":"India"');
  });

  it("treats a reply with no usable summary as invalid output", async () => {
    reply({ role: "", industry: " ", focusAreas: [], question: null });
    await expect(understandFocus({ focusDescription: focus }, scope)).rejects.toMatchObject({ code: "ai_invalid_output" });
  });

  it("passes provider failures through unchanged", async () => {
    const failure = new AIGenerationError("ai_quota", 60);
    generateText.mockRejectedValue(failure);
    await expect(understandFocus({ focusDescription: focus }, scope)).rejects.toBe(failure);
  });

  it("answers the same focus from cache without calling the model again", async () => {
    reply({ role: "Head of Marketing", industry: "OOH", focusAreas: ["DOOH"], region: "India", audience: null, question: null });
    const first = await understandFocus({ focusDescription: focus }, scope);
    expect(await understandFocus({ focusDescription: `  ${focus}  ` }, scope)).toEqual(first);
    expect(generateText).toHaveBeenCalledTimes(1);
  });
});
