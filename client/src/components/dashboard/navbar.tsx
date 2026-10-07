import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { ChevronDown, CreditCard, LogOut, Plus, Settings, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { useCreatePost } from "./create-post-provider";
import { useQuery } from "@tanstack/react-query";
import { signOut, useAuth } from "@/lib/auth";
import { useIsSignedIn } from "@/lib/dev-auth";
import type { User as DbUser } from "@shared/models/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Home",
  "/dashboard/create": "Create post",
  "/dashboard/discover": "Discover",
  "/dashboard/inbox": "Discover",
  "/dashboard/content": "Content",
  "/dashboard/calendar": "Calendar",
  "/dashboard/drafts": "Drafts",
  "/dashboard/published": "Published",
  "/dashboard/connections": "Connections",
  "/dashboard/preferences": "Preferences",
  "/dashboard/plugins": "Preferences",
  "/dashboard/profile": "Content Preferences",
  "/dashboard/settings": "Settings",
  "/dashboard/billing": "Billing",
};

// Persistent top bar above every dashboard page — sidebar toggle, a
// location-derived breadcrumb, and account actions that were previously only
// reachable by opening the sidebar (useful once it's collapsed on mobile).
export function DashboardNavbar() {
  const { openCreate, hasCreation, startNewCreate, composer } = useCreatePost();
  const [location] = useLocation();
  const { setOpenMobile, isMobile } = useSidebar();
  useEffect(() => { setOpenMobile(false); }, [location, setOpenMobile]);
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

  const pageTitle = PAGE_TITLES[location] ?? "Workspace";
  const onCreateRoute = location === "/dashboard/create";

  return (
    <header className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-4 px-3 py-2.5 border-b bg-card text-card-foreground sticky top-0 z-10">
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3">
        <SidebarTrigger className="shrink-0" aria-label={isMobile ? "Open navigation" : "Expand or collapse sidebar"} data-testid="button-navbar-navigation" />
        <Link href="/dashboard" className="flex min-w-0 max-w-full items-center gap-1.5" aria-label="TheSocialPundit dashboard" data-testid="link-navbar-logo">
          <Zap className="w-5 h-5 shrink-0 text-primary fill-primary" />
          <span className="min-w-0 [overflow-wrap:anywhere] font-bold text-base text-primary hidden sm:inline">TheSocialPundit</span>
        </Link>
        <span className="min-w-0 [overflow-wrap:anywhere] text-sm text-muted-foreground hidden md:inline" data-testid="text-navbar-title">
          / <span className="text-foreground font-medium">{pageTitle}</span>
        </span>
      </div>

      <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
      <Button variant={onCreateRoute ? "outline" : "default"} disabled={onCreateRoute && Boolean(composer?.busy || composer?.generation.recoverable)} onClick={() => onCreateRoute ? startNewCreate() : openCreate()} data-testid="button-global-create"><Plus className="h-4 w-4" />{hasCreation && !onCreateRoute ? "Resume creation" : "New post"}</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex min-h-11 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted ring-offset-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Account menu"
            data-testid="button-navbar-account"
          >
            <Avatar className="h-[max(1.75rem,1.5em)] w-[max(1.75rem,1.5em)] text-xs">
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
            <Link href="/dashboard/settings" data-testid="link-navbar-settings">
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/dashboard/settings?tab=billing" data-testid="link-navbar-billing">
              <CreditCard className="w-4 h-4 mr-2" />
              Billing
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => signOut("/")} data-testid="button-navbar-logout">
            <LogOut className="w-4 h-4 mr-2" />
            Log Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
    </header>
  );
}
