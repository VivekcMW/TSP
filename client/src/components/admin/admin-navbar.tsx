import { Link, useLocation } from "wouter";
import { ChevronDown, LogOut, ShieldAlert, ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { signOut, useAuth, useIsSignedIn } from "@/lib/auth";
import type { User as DbUser } from "@shared/models/auth";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PAGE_TITLES: Record<string, string> = {
  "/admin": "Overview",
  "/admin/tenants": "Tenants",
  "/admin/users": "Users",
  "/admin/integrations": "Integrations",
  "/admin/audit-log": "Audit Log",
  "/admin/engine-runs": "Pipeline",
  "/admin/feature-flags": "Feature Flags",
  "/admin/monitoring": "Monitoring",
};

// Same shape as the tenant app's DashboardNavbar, branded for the admin
// surface (a shield mark + "Super Admin" instead of the product logo, and a
// "Back to App" action instead of Plugins/Settings shortcuts) so staff get
// the same breadcrumb + account-menu convenience without confusing the two
// areas' identity.
export function AdminNavbar() {
  const [location] = useLocation();
  const { user } = useAuth();
  const isSignedIn = useIsSignedIn();

  const { data: dbUser } = useQuery<DbUser>({
    queryKey: ["/api/me"],
    enabled: isSignedIn,
  });

  const firstName = user?.firstName ?? dbUser?.firstName ?? "";
  const lastName = user?.lastName ?? dbUser?.lastName ?? "";
  const primaryEmail = user?.email ?? dbUser?.email;
  const initials = firstName && lastName
    ? `${firstName[0]}${lastName[0]}`
    : primaryEmail?.[0]?.toUpperCase() || "U";

  const pageTitle = PAGE_TITLES[location] ?? "Overview";

  return (
    <header className="flex items-center justify-between gap-4 px-3 py-2.5 border-b bg-background sticky top-0 z-10">
      <div className="flex items-center gap-3">
        <SidebarTrigger data-testid="button-admin-sidebar-toggle" />
        <Link href="/admin" className="flex items-center gap-1.5 shrink-0" data-testid="link-admin-navbar-logo">
          <ShieldAlert className="w-5 h-5 text-secondary" />
          <span className="font-bold text-base hidden sm:inline">Super Admin</span>
        </Link>
        <span className="text-sm text-muted-foreground hidden md:inline" data-testid="text-admin-navbar-title">
          / <span className="text-foreground font-medium">{pageTitle}</span>
        </span>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover-elevate"
            data-testid="button-admin-navbar-account"
          >
            <Avatar className="h-7 w-7">
              <AvatarImage src={user?.imageUrl || undefined} alt={firstName || "User"} />
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium truncate">{firstName} {lastName}</p>
            <p className="text-xs text-muted-foreground truncate">{primaryEmail}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/dashboard" data-testid="link-admin-navbar-back">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to App
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => signOut("/")} data-testid="button-admin-navbar-logout">
            <LogOut className="w-4 h-4 mr-2" />
            Log Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
