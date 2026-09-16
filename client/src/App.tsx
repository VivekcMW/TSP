import { lazy, Suspense, useEffect } from "react";
import { Switch, Route, useLocation, useSearch, Router as WouterRouter } from "wouter";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DashboardNavbar } from "@/components/dashboard/navbar";
import { AppFooter } from "@/components/dashboard/app-footer";
import { CreatePostProvider } from "@/components/dashboard/create-post-provider";
import { useAuth } from "@/lib/auth";
import { LoadingScreen } from "@/components/loading-screen";
import { AuthError } from "@/components/auth-error";
import { resolveGate } from "@/lib/gate";
import { AccountBoundary } from "@/lib/account-boundary";
import { AccountAvailability } from "@/lib/account-availability";
import { dashboardRedirectTarget, gateQueryStatus, isAuthenticationError } from "@/lib/integration-security";
import { PublicRoutes } from "@/components/public-routes";
import type { User as DbUser } from "@shared/models/auth";
import type { UserProfile } from "@shared/schema";

import CompleteRegistrationPage from "@/pages/complete-registration";
import OnboardingPage from "@/pages/onboarding";
const OverviewPage = lazy(() => import("@/pages/overview"));
const DashboardPage = lazy(() => import("@/pages/dashboard"));
const DraftsPage = lazy(() => import("@/pages/drafts"));
const PerformancePage = lazy(() => import("@/pages/performance"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const CalendarPage = lazy(() => import("@/pages/calendar"));
import NotFound from "@/pages/not-found";
import { AdminLayout } from "@/components/admin/admin-layout";
const AdminOverviewPage = lazy(() => import("@/pages/admin/overview"));
const AdminTenantsPage = lazy(() => import("@/pages/admin/tenants"));
const AdminUsersPage = lazy(() => import("@/pages/admin/users"));
const AdminIntegrationsPage = lazy(() => import("@/pages/admin/integrations"));
const AdminAuditLogPage = lazy(() => import("@/pages/admin/audit-log"));
const AdminEngineRunsPage = lazy(() => import("@/pages/admin/engine-runs"));
const AdminFeatureFlagsPage = lazy(() => import("@/pages/admin/feature-flags"));
const AdminMonitoringPage = lazy(() => import("@/pages/admin/monitoring"));
import { SignInPage, SignUpPage, VerifyEmailPage } from "@/pages/auth";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  // /api/me.id is a user ID. The resolved tenant comes from /api/profile.
  const { data: profile } = useQuery<UserProfile>({ queryKey: ["/api/profile"], enabled: !!user });
  const style = {
    "--sidebar-width": "14rem",
    "--sidebar-width-icon": "3.5rem",
  };

  return (
    <CreatePostProvider key={JSON.stringify([user?.id, profile?.tenantId])}>
    <SidebarProvider style={style as React.CSSProperties} className="h-full min-h-0">
      <div className="flex h-full w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <DashboardNavbar />
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
          <AppFooter />
        </div>
      </div>
    </SidebarProvider>
    </CreatePostProvider>
  );
}

function DashboardRedirect({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const target = dashboardRedirectTarget(to, search);
  useEffect(() => { setLocation(target, { replace: true }); }, [setLocation, target]);
  return <LoadingScreen />;
}

function DashboardRouter() {
  const [location] = useLocation();
  const shouldReduceMotion = useReducedMotion();

  return (
    <AuthenticatedLayout>
      <AnimatePresence mode="wait">
        <motion.div
          key={location}
          initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="h-full"
        >
          <Suspense fallback={<LoadingScreen />}>
          <Switch>
            <Route path="/dashboard" component={OverviewPage} />
            <Route path="/dashboard/discover" component={DashboardPage} />
            <Route path="/dashboard/inbox"><DashboardRedirect to="/dashboard/discover" /></Route>
            <Route path="/dashboard/content" component={DraftsPage} />
            <Route path="/dashboard/drafts"><DashboardRedirect to="/dashboard/content" /></Route>
            <Route path="/dashboard/published"><DashboardRedirect to="/dashboard/content?view=published" /></Route>
            <Route path="/dashboard/performance" component={PerformancePage} />
            <Route path="/dashboard/connections"><DashboardRedirect to="/dashboard/settings?tab=integrations" /></Route>
            <Route path="/dashboard/analytics"><DashboardRedirect to="/dashboard/performance" /></Route>
            <Route path="/dashboard/preferences"><DashboardRedirect to="/dashboard/settings?tab=publishing" /></Route>
            <Route path="/dashboard/plugins"><DashboardRedirect to="/dashboard/settings?tab=publishing" /></Route>
            <Route path="/dashboard/profile"><DashboardRedirect to="/dashboard/settings?tab=content" /></Route>
            <Route path="/dashboard/settings" component={SettingsPage} />
            <Route path="/dashboard/billing"><DashboardRedirect to="/dashboard/settings?tab=billing" /></Route>
            <Route path="/dashboard/calendar" component={CalendarPage} />
            <Route component={NotFound} />
          </Switch>
          </Suspense>
        </motion.div>
      </AnimatePresence>
    </AuthenticatedLayout>
  );
}

function AdminRouter() {
  const [location] = useLocation();
  const shouldReduceMotion = useReducedMotion();

  return (
    <AdminLayout>
      <AnimatePresence mode="wait">
        <motion.div
          key={location}
          initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="h-full"
        >
          <Suspense fallback={<LoadingScreen />}>
          <Switch>
            <Route path="/admin" component={AdminOverviewPage} />
            <Route path="/admin/tenants" component={AdminTenantsPage} />
            <Route path="/admin/users" component={AdminUsersPage} />
            <Route path="/admin/integrations" component={AdminIntegrationsPage} />
            <Route path="/admin/audit-log" component={AdminAuditLogPage} />
            <Route path="/admin/engine-runs" component={AdminEngineRunsPage} />
            <Route path="/admin/feature-flags" component={AdminFeatureFlagsPage} />
            <Route path="/admin/monitoring" component={AdminMonitoringPage} />
            <Route component={NotFound} />
          </Switch>
          </Suspense>
        </motion.div>
      </AnimatePresence>
    </AdminLayout>
  );
}

/** Wraps a page in the shared enter/exit transition. */
function PageTransition({ transitionKey, children }: { transitionKey: string; children: React.ReactNode }) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={transitionKey}
        initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }}
        transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

function AppRoutes() {
  const { user, isPending } = useAuth();
  const [location, setLocation] = useLocation();

  const authLoaded = !isPending;
  const signedIn = !!user;

  const { data: dbUser, error: dbUserError } = useQuery<DbUser | null>({
    queryKey: ["/api/me"],
    enabled: authLoaded && signedIn,
  });

  const { data: profile, error: profileError } = useQuery<UserProfile>({
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
    if (gate === "redirect-dashboard") setLocation("/dashboard", { replace: true });
    if (gate === "redirect-signin") setLocation("/sign-in", { replace: true });
  }, [gate, setLocation]);

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
      return <AuthError error={isAuthenticationError(profileError) ? profileError : dbUserError ?? profileError} />;

    case "public":
      return (
        <PageTransition transitionKey={transitionKey}>
          <PublicRoutes
            signInRoutes={
              signedIn ? undefined : (
                <>
                  <Route path="/sign-in/*?" component={SignInPage} />
                  <Route path="/sign-up/*?" component={SignUpPage} />
                  <Route path="/verify-email" component={VerifyEmailPage} />
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
          existingName={dbUser?.name}
        />
      );

    case "onboarding":
      return <OnboardingPage />;

    case "dashboard":
      // A failed background refresh must not destroy Settings or Create state.
      // Query errors remain intact: publishing readiness still fails closed.
      return <AccountAvailability unavailable={Boolean(dbUserError || profileError)}>
        {location.startsWith("/admin") ? <AdminRouter /> : <DashboardRouter />}
      </AccountAvailability>;

    case "not-found":
      return <NotFound />;
  }
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <HelmetProvider><TooltipProvider><AccountBoundary><Toaster /><AppRoutes /></AccountBoundary></TooltipProvider></HelmetProvider>
      </QueryClientProvider>
    </WouterRouter>
  );
}

export default App;
