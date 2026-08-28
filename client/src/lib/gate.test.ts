import { describe, expect, it } from "vitest";
import { resolveGate, type GateInput } from "./gate";

/** A signed-in, fully-provisioned user sitting on the dashboard. */
function input(overrides: Partial<GateInput> = {}): GateInput {
  return {
    authLoaded: true,
    signedIn: true,
    me: { status: "ok", registrationCompleted: new Date("2026-01-01") },
    profile: { status: "ok", onboardingStatus: "completed" },
    path: "/dashboard",
    ...overrides,
  };
}

describe("resolveGate", () => {
  it("waits while the auth provider is initialising", () => {
    expect(resolveGate(input({ authLoaded: false }))).toBe("loading");
  });

  describe("signed out", () => {
    const out = (path: string) => resolveGate(input({ signedIn: false, path }));

    it("redirects protected routes to sign-in rather than rendering marketing content", () => {
      expect(out("/dashboard")).toBe("redirect-signin");
      expect(out("/dashboard/analytics")).toBe("redirect-signin");
      expect(out("/onboarding")).toBe("redirect-signin");
    });

    it("404s an unknown route instead of silently serving the landing page", () => {
      expect(out("/nope")).toBe("not-found");
      expect(out("/pricingg")).toBe("not-found");
    });

    it("serves public routes", () => {
      expect(out("/")).toBe("public");
      expect(out("/pricing")).toBe("public");
      expect(out("/blog/some-slug")).toBe("public");
      expect(out("/sign-in")).toBe("public");
    });
  });

  describe("signed in", () => {
    it("bounces sign-in and sign-up to the dashboard", () => {
      expect(resolveGate(input({ path: "/sign-in" }))).toBe("redirect-dashboard");
      expect(resolveGate(input({ path: "/sign-up" }))).toBe("redirect-dashboard");
    });

    it("still allows browsing the marketing site", () => {
      expect(resolveGate(input({ path: "/pricing" }))).toBe("public");
      expect(resolveGate(input({ path: "/blog/x" }))).toBe("public");
    });

    it("reaches the dashboard when registration and onboarding are complete", () => {
      expect(resolveGate(input())).toBe("dashboard");
      expect(resolveGate(input({ path: "/dashboard/drafts" }))).toBe("dashboard");
    });

    it("404s an unknown route", () => {
      expect(resolveGate(input({ path: "/nope" }))).toBe("not-found");
    });
  });

  describe("the trap these tests exist for", () => {
    it("surfaces a failed /api/me as an auth error, never as 'register'", () => {
      const state = resolveGate(
        input({ me: { status: "error", registrationCompleted: null } }),
      );
      expect(state).toBe("auth-error");
      expect(state).not.toBe("register");
    });

    it("surfaces a failed /api/profile as an auth error, never as 'onboarding'", () => {
      const state = resolveGate(
        input({ profile: { status: "error", onboardingStatus: null } }),
      );
      expect(state).toBe("auth-error");
      expect(state).not.toBe("onboarding");
    });

    it("prefers the auth error over the registration form even on a dashboard path", () => {
      expect(
        resolveGate(
          input({
            me: { status: "error", registrationCompleted: null },
            path: "/dashboard/analytics",
          }),
        ),
      ).toBe("auth-error");
    });
  });

  describe("registration and onboarding", () => {
    it("asks for registration when it is not complete", () => {
      expect(
        resolveGate(input({ me: { status: "ok", registrationCompleted: null } })),
      ).toBe("register");
    });

    it("waits for /api/me before deciding", () => {
      expect(
        resolveGate(input({ me: { status: "loading", registrationCompleted: null } })),
      ).toBe("loading");
    });

    it("waits for /api/profile before deciding on onboarding", () => {
      expect(
        resolveGate(input({ profile: { status: "loading", onboardingStatus: null } })),
      ).toBe("loading");
    });

    it("routes to onboarding when the profile is not yet completed", () => {
      expect(
        resolveGate(input({ profile: { status: "ok", onboardingStatus: "pending" } })),
      ).toBe("onboarding");
    });

    it("honours an explicit /onboarding visit even once complete", () => {
      expect(resolveGate(input({ path: "/onboarding" }))).toBe("onboarding");
    });
  });
});
