import { lazy, Suspense, useEffect } from "react";
import { Switch, Route, useLocation, useSearch, Router as WouterRouter } from "wouter";
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
import { devAuthEnabled } from "@/lib/dev-auth";
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
import NotFound from "@/pages/not-found";
import { AdminLayout } from "@/components/admin/admin-layout";
import { DecorativeIcons } from "@/components/decorative-icons";
import { RouteTransition } from "@/components/route-transition";
import { CookieConsent } from "@/components/cookie-consent";
import { SignInPage, SignUpPage, VerifyEmailPage } from "@/pages/auth";

const OverviewPage = lazy(() => import("@/pages/overview"));
const DashboardPage = lazy(() => import("@/pages/dashboard"));
const DraftsPage = lazy(() => import("@/pages/drafts"));
const PerformancePage = lazy(() => import("@/pages/performance"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const CalendarPage = lazy(() => import("@/pages/calendar"));
const CreatePostPage = lazy(() => import("@/pages/create-post"));
const AdminOverviewPage = lazy(() => import("@/pages/admin/overview"));
const AdminTenantsPage = lazy(() => import("@/pages/admin/tenants"));
const AdminUsersPage = lazy(() => import("@/pages/admin/users"));
const AdminIntegrationsPage = lazy(() => import("@/pages/admin/integrations"));
const AdminAuditLogPage = lazy(() => import("@/pages/admin/audit-log"));
const AdminEngineRunsPage = lazy(() => import("@/pages/admin/engine-runs"));
const AdminFeatureFlagsPage = lazy(() => import("@/pages/admin/feature-flags"));
const AdminMonitoringPage = lazy(() => import("@/pages/admin/monitoring"));

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

  return (
    <AuthenticatedLayout>
      <RouteTransition transitionKey={path => path} className="h-full">
        {location => (
          <Suspense fallback={<LoadingScreen />}>
          <Switch location={location}>
            <Route path="/dashboard" component={OverviewPage} />
            <Route path="/dashboard/create" component={CreatePostPage} />
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
            <Route path="/dashboard/profile-setup"><DashboardRedirect to="/dashboard/settings?tab=content" /></Route>
            <Route path="/dashboard/settings" component={SettingsPage} />
            <Route path="/dashboard/billing"><DashboardRedirect to="/dashboard/settings?tab=billing" /></Route>
            <Route path="/dashboard/calendar" component={CalendarPage} />
            <Route component={NotFound} />
          </Switch>
          </Suspense>
        )}
      </RouteTransition>
    </AuthenticatedLayout>
  );
}

function AdminRouter() {

  return (
    <AdminLayout>
      <RouteTransition transitionKey={path => path} className="h-full">
        {location => (
          <Suspense fallback={<LoadingScreen />}>
          <Switch location={location}>
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
        )}
      </RouteTransition>
    </AdminLayout>
  );
}

function AppRoutes() {
  const { user, isPending } = useAuth();
  const [location, setLocation] = useLocation();

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

  // `undefined` data means "not resolved yet" — more reliable than isLoading,
  // which is false for a query that is enabled but has not started, and which
  // previously let a "registration incomplete" screen flash before the fetch.
  const gate = resolveGate({
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
    if (gate === "redirect-dashboard") setLocation("/dashboard", { replace: true });
    if (gate === "redirect-signin") setLocation("/sign-in", { replace: true });
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
        <RouteTransition transitionKey={transitionKey}>
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
        <HelmetProvider><TooltipProvider><DecorativeIcons><AccountBoundary><Toaster /><AppRoutes /><CookieConsent /></AccountBoundary></DecorativeIcons></TooltipProvider></HelmetProvider>
      </QueryClientProvider>
    </WouterRouter>
  );
}

export default App;
