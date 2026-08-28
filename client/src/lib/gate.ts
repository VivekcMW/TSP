/**
 * The routing gate, as a pure function.
 *
 * This decision used to live as a cascade of `if`s inside AppRoutes, which made
 * it untestable without rendering the whole app inside a ClerkProvider — and it
 * hid a bug: any failure of /api/me or /api/profile fell through to the
 * "registration not completed" / "onboarding not completed" branches, pinning
 * the user to a form whose submit hit the same failing endpoint.
 *
 * Keeping it pure means every branch is testable with a plain object.
 */

export type GateState =
  | "loading"
  | "public"
  | "redirect-signin"
  | "redirect-dashboard"
  | "auth-error"
  | "register"
  | "onboarding"
  | "dashboard"
  | "not-found";

export type QueryStatus = "loading" | "error" | "ok";

export interface GateInput {
  /** Has the auth provider finished initialising? */
  authLoaded: boolean;
  signedIn: boolean;
  me: {
    status: QueryStatus;
    /** Truthy once the user has completed the registration form. */
    registrationCompleted: unknown;
  };
  profile: {
    status: QueryStatus;
    onboardingStatus: string | null;
  };
  /** Current location, without the router base path. */
  path: string;
}

/** Routes reachable without being signed in. */
export const PUBLIC_PATHS = [
  "/",
  "/pricing",
  "/how-it-works",
  "/industries",
  "/blog",
  "/resources",
  "/about",
  "/contact",
  "/privacy",
  "/terms",
  "/case-studies",
  "/careers",
] as const;

export function isAuthGatewayPath(path: string): boolean {
  return path === "/sign-in" || path === "/sign-up";
}

export function isPublicPath(path: string): boolean {
  return (
    (PUBLIC_PATHS as readonly string[]).includes(path) ||
    path.startsWith("/blog/") ||
    isAuthGatewayPath(path)
  );
}

function isProtectedPath(path: string): boolean {
  return path.startsWith("/dashboard") || path === "/onboarding";
}

export function resolveGate(input: GateInput): GateState {
  const { authLoaded, signedIn, me, profile, path } = input;

  if (!authLoaded) return "loading";

  if (!signedIn) {
    // Previously this rendered the landing page while leaving the URL on
    // /dashboard, so a bookmarked dashboard link showed marketing content and
    // reloading repeated it. Redirect instead.
    if (isProtectedPath(path)) return "redirect-signin";
    // An unknown URL used to fall through to the landing page with a 200,
    // which served marketing content for every typo. 404 it, the same as for
    // a signed-in user.
    return isPublicPath(path) ? "public" : "not-found";
  }

  // Signed in and sitting on a sign-in/sign-up route: go to the app.
  if (isAuthGatewayPath(path)) return "redirect-dashboard";

  // Signed-in users can still browse the marketing site.
  if (isPublicPath(path)) return "public";

  if (me.status === "loading") return "loading";
  // Must precede the registration branch — see the note at the top.
  if (me.status === "error") return "auth-error";

  if (!me.registrationCompleted) return "register";

  if (profile.status === "loading") return "loading";
  // Must precede the onboarding branch, for the same reason.
  if (profile.status === "error") return "auth-error";

  const onboardingComplete = profile.onboardingStatus === "completed";
  if (path === "/onboarding" || (!onboardingComplete && path.startsWith("/dashboard"))) {
    return "onboarding";
  }

  if (path.startsWith("/dashboard")) return "dashboard";

  return "not-found";
}
