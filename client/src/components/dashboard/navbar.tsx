import { Link, useLocation } from "wouter";
import { ChevronDown, CreditCard, LogOut, Plus, Settings, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCreatePost } from "./create-post-provider";
import { useQuery } from "@tanstack/react-query";
import { signOut, useAuth, useIsSignedIn } from "@/lib/auth";
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
  "/dashboard/performance": "Performance",
  "/dashboard/connections": "Connections",
  "/dashboard/analytics": "Performance",
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
  const { openCreate } = useCreatePost();
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

  const pageTitle = PAGE_TITLES[location] ?? "Workspace";

  return (
    <header className="flex items-center justify-between gap-4 px-3 py-2.5 border-b bg-background sticky top-0 z-10">
      <div className="flex items-center gap-3">
        <Link href="/dashboard" className="flex items-center gap-1.5 shrink-0" aria-label="TheSocialPundit dashboard" data-testid="link-navbar-logo">
          <Zap className="w-5 h-5 text-primary fill-primary" />
          <span className="font-bold text-base text-primary hidden sm:inline">TheSocialPundit</span>
        </Link>
        <span className="text-sm text-muted-foreground hidden md:inline" data-testid="text-navbar-title">
          / <span className="text-foreground font-medium">{pageTitle}</span>
        </span>
      </div>

      <div className="flex items-center gap-2">
      <Button onClick={() => openCreate()} data-testid="button-global-create"><Plus className="mr-1.5 h-4 w-4" />Create</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex min-h-11 items-center gap-2 rounded-md px-2 py-1.5 hover-elevate"
            aria-label="Account menu"
            data-testid="button-navbar-account"
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
