import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ScheduleTargetActions } from "./calendar";

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