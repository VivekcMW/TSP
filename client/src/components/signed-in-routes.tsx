import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Switch, Route, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DashboardNavbar } from "@/components/dashboard/navbar";
import { AppFooter } from "@/components/dashboard/app-footer";
import { CreatePostProvider } from "@/components/dashboard/create-post-provider";
import { AdminLayout } from "@/components/admin/admin-layout";
import { LoadingScreen } from "@/components/loading-screen";
import { RouteTransition } from "@/components/route-transition";
import { useAuth } from "@/lib/auth";
import { dashboardRedirectTarget } from "@/lib/integration-security";
import NotFound from "@/pages/not-found";
import type { UserProfile } from "@shared/schema";
import { AnalyticsPage } from "@/components/analytics-page";

/**
 * The signed-in app: dashboard and admin routers with their layouts. Loaded lazily from
 * App.tsx, so none of this is in the bundle public visitors download.
 */
const OverviewPage = lazy(() => import("@/pages/overview"));
const DashboardPage = lazy(() => import("@/pages/dashboard"));
const DraftsPage = lazy(() => import("@/pages/drafts"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const CalendarPage = lazy(() => import("@/pages/calendar"));
const CreatePostPage = lazy(() => import("@/pages/create-post"));
const AcceptInvitePage = lazy(() => import("@/pages/accept-invite"));
const AdminOverviewPage = lazy(() => import("@/pages/admin/overview"));
const AdminTenantsPage = lazy(() => import("@/pages/admin/tenants"));
const AdminUsersPage = lazy(() => import("@/pages/admin/users"));
const AdminIntegrationsPage = lazy(() => import("@/pages/admin/integrations"));
const AdminAuditLogPage = lazy(() => import("@/pages/admin/audit-log"));
const AdminEngineRunsPage = lazy(() => import("@/pages/admin/engine-runs"));
const AdminFeatureFlagsPage = lazy(() => import("@/pages/admin/feature-flags"));
const AdminMonitoringPage = lazy(() => import("@/pages/admin/monitoring"));

function AuthenticatedLayout({ children }: { children: ReactNode }) {
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
            <Route path="/dashboard/create" component={CreatePostPage} />
            <Route path="/dashboard/discover" component={DashboardPage} />
            <Route path="/dashboard/inbox"><DashboardRedirect to="/dashboard/discover" /></Route>
            <Route path="/dashboard/content" component={DraftsPage} />
            <Route path="/dashboard/drafts"><DashboardRedirect to="/dashboard/content" /></Route>
            <Route path="/dashboard/published"><DashboardRedirect to="/dashboard/content?view=published" /></Route>
            {/* Performance is paused; keep old bookmarks usable without exposing the page. */}
            <Route path="/dashboard/performance"><DashboardRedirect to="/dashboard" /></Route>
            <Route path="/dashboard/connections"><DashboardRedirect to="/dashboard/settings?tab=integrations" /></Route>
            <Route path="/dashboard/analytics"><DashboardRedirect to="/dashboard" /></Route>
            <Route path="/dashboard/preferences"><DashboardRedirect to="/dashboard/settings?tab=publishing" /></Route>
            <Route path="/dashboard/plugins"><DashboardRedirect to="/dashboard/settings?tab=publishing" /></Route>
            <Route path="/dashboard/profile"><DashboardRedirect to="/dashboard/settings?tab=content" /></Route>
            <Route path="/dashboard/profile-setup"><DashboardRedirect to="/dashboard/settings?tab=content" /></Route>
            <Route path="/dashboard/settings" component={SettingsPage} />
            <Route path="/dashboard/billing"><DashboardRedirect to="/dashboard/settings?tab=billing" /></Route>
            <Route path="/dashboard/calendar" component={CalendarPage} />
            <Route path="/dashboard/accept-invite" component={AcceptInvitePage} />
            <Route path="/dashboard" component={OverviewPage} />
            <Route component={NotFound} />
          </Switch>
          <AnalyticsPage path={location} />
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
          <AnalyticsPage path={location} />
          </Suspense>
        )}
      </RouteTransition>
    </AdminLayout>
  );
}

export default function SignedInRoutes({ admin }: { admin: boolean }) {
  return admin ? <AdminRouter /> : <DashboardRouter />;
}
