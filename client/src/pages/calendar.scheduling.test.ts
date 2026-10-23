import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ScheduleTargetActions } from "./calendar";
import { calendarStatus } from "@/components/dashboard/calendar-planner";

// Vitest's Node config uses classic JSX; the app's Vite React plugin is automatic.
beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

function render(status: string, lastError?: string) {
  return renderToStaticMarkup(React.createElement(ScheduleTargetActions, { item: {
    id: "s", draftId: "d", scheduledPublishAt: new Date(0).toISOString(), status,
    targets: [{ id: "t", platform: "linkedin", status, lastError }],
  } }));
}

describe("calendar target controls", () => {
  it("offers scoped retry and cancel only on a failed target", () => {
    const html = render("failed", "Reconnect account");
    expect(html).toContain('aria-label="Retry linkedin"');
    expect(html).toContain('aria-label="Cancel linkedin"');
    expect(html).toContain("Reconnect account");
  });

  describe("calendar status presentation", () => {
    it.each([
      ["scheduled", ["scheduled"], "pending", "Scheduled"],
      ["scheduled", ["publishing"], "pending", "Publishing"],
      ["published", ["published"], "published", "Published"],
      ["published", [], "attention", "Check delivery"],
      ["published", ["legacy_unverified"], "attention", "Needs attention"],
      ["partial", ["published", "failed"], "attention", "Needs attention"],
      ["scheduled", ["queued", "failed"], "attention", "Needs attention"],
      ["unknown", ["unknown"], "attention", "Needs attention"],
      ["accepted_unverified", ["accepted_unverified"], "attention", "Needs attention"],
      ["manual_published", ["manual_published"], "attention", "Check delivery"],
      ["simulated", ["simulated"], "simulated", "Demo only"],
      ["cancelled", ["cancelled"], "cancelled", "Cancelled"],
    ])("labels %s with targets %j accurately", (status, states, key, label) => {
      const result = calendarStatus({
        id: "schedule", draftId: "draft", status, scheduledPublishAt: "2026-09-20T09:00:00Z",
        targets: states.map((value, index) => ({ id: `t-${index}`, status: value, platform: "linkedin" })),
      });
      expect(result).toMatchObject({ key, label });
    });
  });
  it.each(["scheduled", "queued"])("offers cancellation but not retry while %s", (status) => {
    const html = render(status);
    expect(html).toContain('aria-label="Cancel linkedin"');
    expect(html).not.toContain('aria-label="Retry linkedin"');
  });
  it.each(["publishing", "unknown", "published", "cancelled"])("does not offer unsafe controls for %s", (status) => {
    const html = render(status);
    expect(html).not.toContain("<button");
    if (status === "unknown") expect(html).toContain("delivery could have succeeded");
    if (status === "publishing") expect(html).toContain("Cancellation is no longer safe");
  });
});