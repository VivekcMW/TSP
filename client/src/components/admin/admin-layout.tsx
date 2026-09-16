import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { useIsSignedIn } from "@/lib/dev-auth";
import type { User as DbUser } from "@shared/models/auth";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminNavbar } from "@/components/admin/admin-navbar";
import { AppFooter } from "@/components/dashboard/app-footer";

/**
 * Shell for the Super Admin surface, deliberately mirroring the tenant app's
 * AuthenticatedLayout (collapsible icon sidebar + navbar + footer) so staff
 * get the same familiar, polished chrome — just branded and gated
 * differently, not a lesser one-off top-tabs layout.
 *
 * This client-side gate is a UX convenience only. The real authorization is
 * server-side: every /api/admin/* route is behind requirePermission, which
 * rejects non-staff regardless of what this component renders.
 */
export function AdminLayout({ children }: { children: React.ReactNode }) {
  const isSignedIn = useIsSignedIn();

  const { data: dbUser, isLoading } = useQuery<DbUser>({
    queryKey: ["/api/me"],
    enabled: !!isSignedIn,
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!dbUser?.platformRole) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-sm text-center space-y-3">
          <ShieldAlert className="w-10 h-10 text-destructive mx-auto" />
          <h1 className="heading-dashboard text-xl">Staff access only</h1>
          <p className="text-sm text-muted-foreground">
            This area is restricted to platform staff. If you believe this is a mistake, contact an administrator.
          </p>
          <Link href="/dashboard" className="text-sm text-primary hover:underline inline-flex items-center gap-1" data-testid="link-admin-denied-back">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const style = {
    "--sidebar-width": "14rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AdminSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <AdminNavbar />
          <div className="flex-1 overflow-hidden">{children}</div>
          <AppFooter />
        </div>
      </div>
    </SidebarProvider>
  );
}

