import { useEffect, useRef } from "react";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ClerkProvider, SignIn, SignUp, useClerk, useUser } from "@clerk/react";
import { LoadingScreen } from "@/components/loading-screen";
import { AuthError } from "@/components/auth-error";
import { devAuthEnabled } from "@/lib/dev-auth";
import { resolveGate } from "@/lib/gate";
import { PublicRoutes } from "@/components/public-routes";
import { buildClerkAppearance } from "@/lib/clerk-appearance";
import type { User as DbUser } from "@shared/models/auth";

import CompleteRegistrationPage from "@/pages/complete-registration";
import OnboardingPage from "@/pages/onboarding";
import DashboardPage from "@/pages/dashboard";
import DraftsPage from "@/pages/drafts";
import PublishedPage from "@/pages/published";
import AnalyticsPage from "@/pages/analytics";
import SettingsPage from "@/pages/settings";
import ProfileSettingsPage from "@/pages/profile-settings";
import NotFound from "@/pages/not-found";

// Single deployment domain, so the key comes straight from the environment.
// This previously routed through publishableKeyFromHost + a Clerk FAPI proxy to
// support multiple Replit/custom domains from one build; both are gone.
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const clerkAppearance = buildClerkAppearance(basePath);

// Clerk passes full paths to routerPush/routerReplace, but wouter's
// setLocation prepends the base — strip it to avoid doubling.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      {/* path must be the full browser path — Clerk reads window.location.pathname directly */}
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

// Helps the client stay in sync when the signed-in user changes by invalidating the QueryClient cache.
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-4 p-3 border-b bg-background sticky top-0 z-10">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
          </header>
          <div className="flex-1 overflow-hidden">{children}</div>
        </div>
      </div>
    </SidebarProvider>
  );
}

function DashboardRouter() {
  const [location] = useLocation();

  return (
    <AuthenticatedLayout>
      <AnimatePresence mode="wait">
        <motion.div
          key={location}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="h-full"
        >
          <Switch>
            <Route path="/dashboard" component={DashboardPage} />
            <Route path="/dashboard/drafts" component={DraftsPage} />
            <Route path="/dashboard/published" component={PublishedPage} />
            <Route path="/dashboard/analytics" component={AnalyticsPage} />
            <Route path="/dashboard/profile" component={ProfileSettingsPage} />
            <Route path="/dashboard/settings" component={SettingsPage} />
            <Route component={DashboardPage} />
          </Switch>
        </motion.div>
      </AnimatePresence>
    </AuthenticatedLayout>
  );
}

/** Wraps a page in the shared enter/exit transition. */
function PageTransition({ transitionKey, children }: { transitionKey: string; children: React.ReactNode }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={transitionKey}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

function AppRoutes() {
  const { isLoaded: clerkLoaded, isSignedIn: clerkSignedIn } = useUser();
  const [location, setLocation] = useLocation();

  // TEMPORARY: with the bypass on, treat Clerk as loaded and signed in. This
  // also covers the case where Clerk never finishes loading (bad key, blocked
  // FAPI), which would otherwise hold the app on the loading screen forever.
  const authLoaded = devAuthEnabled || clerkLoaded;
  const signedIn = devAuthEnabled || !!clerkSignedIn;

  const { data: dbUser, error: dbUserError } = useQuery<DbUser | null>({
    queryKey: ["/api/me"],
    enabled: authLoaded && signedIn,
  });

  const { data: profile, error: profileError } = useQuery<{ onboardingStatus?: string }>({
    queryKey: ["/api/profile"],
    enabled: authLoaded && signedIn,
  });

  // `undefined` data means "not resolved yet" — more reliable than isLoading,
  // which is false for a query that is enabled but has not started, and which
  // previously let a "registration incomplete" screen flash before the fetch.
  const gate = resolveGate({
    authLoaded,
    signedIn,
    me: {
      status: dbUserError ? "error" : dbUser === undefined ? "loading" : "ok",
      registrationCompleted: dbUser?.registrationCompleted ?? null,
    },
    profile: {
      status: profileError ? "error" : profile === undefined ? "loading" : "ok",
      onboardingStatus: profile?.onboardingStatus ?? null,
    },
    path: location,
  });

  // Redirects run in an effect. The old code called setLocation() in the render
  // body, which React warns about and which duplicated an existing effect.
  useEffect(() => {
    if (gate === "redirect-dashboard") setLocation("/dashboard", { replace: true });
    if (gate === "redirect-signin") setLocation("/sign-in", { replace: true });
  }, [gate, setLocation]);

  // Collapse Clerk's internal multi-step sub-paths (e.g. /sign-up/verify-email-address)
  // to one key so the transition doesn't replay on every step of the auth flow.
  const transitionKey = location.startsWith("/sign-in")
    ? "/sign-in"
    : location.startsWith("/sign-up")
      ? "/sign-up"
      : location;

  switch (gate) {
    case "loading":
    // Rendered for the single frame before the redirect effect runs.
    case "redirect-signin":
    case "redirect-dashboard":
      return <LoadingScreen />;

    case "auth-error":
      return <AuthError error={dbUserError ?? profileError} />;

    case "public":
      return (
        <PageTransition transitionKey={transitionKey}>
          <PublicRoutes
            signInRoutes={
              signedIn ? undefined : (
                <>
                  <Route path="/sign-in/*?" component={SignInPage} />
                  <Route path="/sign-up/*?" component={SignUpPage} />
                </>
              )
            }
          />
        </PageTransition>
      );

    case "register":
      return (
        <CompleteRegistrationPage
          existingFirstName={dbUser?.firstName}
          existingLastName={dbUser?.lastName}
        />
      );

    case "onboarding":
      return <OnboardingPage />;

    case "dashboard":
      return <DashboardRouter />;

    case "not-found":
      return <NotFound />;
  }
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to TheSocialPundit",
          },
        },
        signUp: {
          start: {
            title: "Create your account",
            subtitle: "Get started with TheSocialPundit",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <HelmetProvider>
          <TooltipProvider>
            <Toaster />
            <AppRoutes />
          </TooltipProvider>
        </HelmetProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
