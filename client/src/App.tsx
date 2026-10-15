import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { Route, useLocation, Router as WouterRouter } from "wouter";
import { accountCache, queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/auth";
import { devAuthEnabled } from "@/lib/dev-auth";
import { LoadingScreen } from "@/components/loading-screen";
import { AuthError } from "@/components/auth-error";
import { resolveGate } from "@/lib/gate";
import { AccountBoundary } from "@/lib/account-boundary";
import { AccountAvailability } from "@/lib/account-availability";
import { gateQueryStatus, isAuthenticationError } from "@/lib/integration-security";
import { PublicRoutes } from "@/components/public-routes";
import type { User as DbUser } from "@shared/models/auth";
import type { UserProfile } from "@shared/schema";

import NotFound from "@/pages/not-found";
import { DecorativeIcons } from "@/components/decorative-icons";
import { RouteTransition } from "@/components/route-transition";
import { CookieConsent } from "@/components/cookie-consent";
import { rememberReturnTo, takeReturnTo } from "@/lib/return-to";
import { SignInPage, SignUpPage, VerifyEmailPage } from "@/pages/auth";
import { bootedFromPrerender } from "@/lib/prerender";
import { schedulePageView } from "@/lib/analytics-consent";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Analytics page views for in-app navigation. The first page view is sent by the
// analytics loader itself (on start-up, or when the visitor accepts mid-page).
function PageViews() {
  const [location] = useLocation();
  const initial = useRef(true);
  useEffect(() => {
    if (initial.current) { initial.current = false; return; }
    schedulePageView();
  }, [location]);
  return null;
}

// Signed-in areas load on demand, so public visitors never download dashboard code.
const SignedInRoutes = lazy(() => import("@/components/signed-in-routes"));
const OnboardingPage = lazy(() => import("@/pages/onboarding"));
const CompleteRegistrationPage = lazy(() => import("@/pages/complete-registration"));

function AppRoutes() {
  const { user, isPending } = useAuth();
  const [location, setLocation] = useLocation();
  const scope = useSyncExternalStore(accountCache.subscribe, accountCache.getSnapshot);
  const accountId = user?.id ?? null;

  const authLoaded = !isPending;
  const signedIn = !!user;

  // Only explicit local development bypass may replace a Better Auth session.
  // Otherwise fetching /api/me after logout can recreate cleared private data.
  const sessionAvailable = signedIn || devAuthEnabled;
  const { data: dbUser, error: dbUserError } = useQuery<DbUser | null>({
    queryKey: ["/api/me"],
    enabled: authLoaded && sessionAvailable,
  });

  const { data: profile, error: profileError } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
    enabled: authLoaded && sessionAvailable,
  });

  const tenantId = profile?.tenantId;
  useLayoutEffect(() => {
    if (authLoaded && sessionAvailable && tenantId) void accountCache.synchronizeTenant(accountId, tenantId);
  }, [accountId, authLoaded, sessionAvailable, tenantId]);
  // Hide old descendants on the detecting render, BEFORE effects clear their
  // shared keys. A composer-only key change still reads the previous inbox.
  // Availability failures keep the last resolved tenant and local work intact.
  const boundaryPending = scope.pending || scope.signingOut || scope.accountId !== accountId ||
    (sessionAvailable && Boolean(tenantId) && scope.tenantId !== tenantId);

  // `undefined` data means "not resolved yet" — more reliable than isLoading,
  // which is false for a query that is enabled but has not started, and which
  // previously let a "registration incomplete" screen flash before the fetch.
  const gate = boundaryPending ? "loading" : resolveGate({
    authLoaded,
    signedIn: sessionAvailable,
    me: {
      status: gateQueryStatus(dbUser, dbUserError),
      registrationCompleted: dbUser?.registrationCompleted ?? null,
    },
    profile: {
      status: gateQueryStatus(profile, profileError),
      onboardingStatus: profile?.onboardingStatus ?? null,
    },
    path: location,
  });

  // Redirects run in an effect. The old code called setLocation() in the render
  // body, which React warns about and which duplicated an existing effect.
  useEffect(() => {
    if (gate === "redirect-dashboard") setLocation(takeReturnTo() ?? "/dashboard", { replace: true });
    if (gate === "redirect-signin") {
      rememberReturnTo(window.location.pathname + window.location.search);
      setLocation("/sign-in", { replace: true });
    }
  }, [gate, setLocation]);

  // Sign-in and sign-up sub-steps stay one page, so their forms keep state.
  const transitionKey = (path: string) => path.startsWith("/sign-in") ? "/sign-in" : path.startsWith("/sign-up") ? "/sign-up" : path;

  switch (gate) {
    case "loading":
    // Rendered for the single frame before the redirect effect runs.
    case "redirect-signin":
    case "redirect-dashboard":
      return <LoadingScreen />;

    case "auth-error":
      return <AuthError error={isAuthenticationError(profileError) ? profileError : dbUserError ?? profileError} />;

    case "public":
      return (
        <RouteTransition transitionKey={transitionKey} skipInitialAnimation={bootedFromPrerender}>
          {path => <PublicRoutes
            location={path}
            signInRoutes={
              signedIn ? undefined : (
                <>
                  <Route path="/sign-in/*?" component={SignInPage} />
                  <Route path="/sign-up/*?" component={SignUpPage} />
                  <Route path="/verify-email" component={VerifyEmailPage} />
                </>
              )
            }
          />}
        </RouteTransition>
      );

    case "register":
      return (
        <Suspense fallback={<LoadingScreen />}>
          <CompleteRegistrationPage
            existingFirstName={dbUser?.firstName}
            existingLastName={dbUser?.lastName}
            existingName={dbUser?.name}
          />
        </Suspense>
      );

    case "onboarding":
      return <Suspense fallback={<LoadingScreen />}><OnboardingPage /></Suspense>;

    case "dashboard":
      // A failed background refresh must not destroy Settings or Create state.
      // Query errors remain intact: publishing readiness still fails closed.
      return <AccountAvailability key={JSON.stringify([scope.accountId, scope.tenantId])} unavailable={Boolean(dbUserError || profileError)}>
        <Suspense fallback={<LoadingScreen />}><SignedInRoutes admin={location.startsWith("/admin")} /></Suspense>
      </AccountAvailability>;

    case "not-found":
      return <NotFound />;
  }
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <HelmetProvider><TooltipProvider><DecorativeIcons><AccountBoundary><Toaster /><AppRoutes /><CookieConsent /><PageViews /></AccountBoundary></DecorativeIcons></TooltipProvider></HelmetProvider>
      </QueryClientProvider>
    </WouterRouter>
  );
}

export default App;
