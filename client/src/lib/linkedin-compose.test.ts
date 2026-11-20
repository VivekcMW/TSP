import { describe, expect, it } from "vitest";
import { generationRequest, nextMorning, postingOutcome } from "./linkedin-compose";

const source = { id: "s1", headline: "Story", source: "Wire", articleUrl: "https://news.test/s1" };

describe("LinkedIn composer helpers", () => {
  it("reports queued, published, simulated and failed outcomes without overstating delivery", () => {
    expect(postingOutcome({ jobIds: ["job"], results: [] }).title).toBe("Sending to LinkedIn");
    expect(postingOutcome({ results: [{ platform: "linkedin", status: "published" }] })).toMatchObject({ tone: "success", title: "Posted to LinkedIn" });
    expect(postingOutcome({ results: [{ platform: "linkedin", status: "simulated" }] }).title).toBe("Simulated — nothing was posted");
    expect(postingOutcome({ results: [{ platform: "linkedin", status: "failed" }] }).tone).toBe("error");
    expect(postingOutcome({ results: [{ platform: "linkedin", status: "unknown" }] }).title).toBe("Delivery not confirmed");
  });

  it("schedules for 9:00 local time the next day, skipping weekends when asked", () => {
    const friday = new Date(2026, 10, 20, 14, 30);
    expect(nextMorning(friday)).toEqual(new Date(2026, 10, 21, 9, 0));
    expect(nextMorning(friday, true)).toEqual(new Date(2026, 10, 23, 9, 0));
  });

  it("builds one LinkedIn generation from a story or from a substantial idea", () => {
    expect(generationRequest({ source, angle: "Questions buyers ask", take: "Compare definitions first", toneKey: "thoughtLeader" })).toEqual({
      endpoint: "/api/instant-review/selected",
      body: { selectedPlatforms: ["linkedin"], tones: ["thoughtLeader"], format: "short-post", userContext: "Angle: Questions buyers ask\nMy take: Compare definitions first", url: source.articleUrl },
    });
    expect(generationRequest({ angle: "Short", take: "", toneKey: "thoughtLeader" })).toEqual({ error: "Describe your idea in at least 20 characters, or start from a story." });
    const manual = generationRequest({ angle: "Measurement myths", take: "Most dashboards compare different definitions.", toneKey: "dataDriven" });
    expect(manual).toMatchObject({ endpoint: "/api/instant-review/manual", body: { title: "Measurement myths", selectedPlatforms: ["linkedin"], tones: ["dataDriven"] } });
  });
});
