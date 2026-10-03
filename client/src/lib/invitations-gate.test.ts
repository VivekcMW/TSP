import { describe, expect, it } from "vitest";
import { isPublicPath, resolveGate } from "./gate";

describe("Invitation preferences public gate", () => {
  it.each([false, true])("is public with signedIn=%s even when account queries fail", (signedIn) => {
    expect(resolveGate({ authLoaded: true, signedIn, path: "/invitation-preferences", me: { status: "error", registrationCompleted: null }, profile: { status: "error", onboardingStatus: null } })).toBe("public");
  });
  it("only permits the exact public page, not private invitations or arbitrary children", () => {
    expect(isPublicPath("/invitation-preferences")).toBe(true);
    expect(isPublicPath("/invitation-preferences/anything")).toBe(false);
    expect(isPublicPath("/dashboard/settings")).toBe(false);
    expect(isPublicPath("/api/invitations")).toBe(false);
  });
});