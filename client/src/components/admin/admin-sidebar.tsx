import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, Building2, Users, ScrollText, Activity, Flag, Plug, ArrowLeft,
} from "lucide-react";
import { useAuth, useIsSignedIn } from "@/lib/auth";
import type { User as DbUser } from "@shared/models/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const adminNav = [
  { title: "Overview", url: "/admin", icon: LayoutDashboard },
  { title: "Tenants", url: "/admin/tenants", icon: Building2 },
  { title: "Users", url: "/admin/users", icon: Users },
  { title: "Integrations", url: "/admin/integrations", icon: Plug },
  { title: "Audit Log", url: "/admin/audit-log", icon: ScrollText },
  { title: "Pipeline", url: "/admin/engine-runs", icon: Activity },
  { title: "Monitoring", url: "/admin/monitoring", icon: Activity },
  { title: "Feature Flags", url: "/admin/feature-flags", icon: Flag },
];

const adminOnlyTitles = new Set(["Integrations", "Pipeline", "Feature Flags"]);

// Same collapsible icon-rail sidebar as the tenant app's AppSidebar, but with
// the cross-tenant admin nav instead — kept as a separate component (rather
// than parameterising AppSidebar) since the two navs, and the "back to app"
// footer link, have nothing in common with the subscriber sidebar's
// Hot Trends widget.
export function AdminSidebar() {
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

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {adminNav.filter((item) => dbUser?.platformRole === "platform_admin" || !adminOnlyTitles.has(item.title)).map((item) => {
                const isActive = location === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      data-testid={`admin-nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <Link href={item.url} className="relative" aria-current={isActive ? "page" : undefined}>
                        {isActive && (
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-y-1 left-0 border-l-2 border-sidebar-primary"
                          />
                        )}
                        <item.icon className={`w-4 h-4 ${isActive ? "text-sidebar-accent-foreground" : ""}`} />
                        <span className={isActive ? "font-medium text-sidebar-accent-foreground" : ""}>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="group-data-[collapsible=icon]:hidden mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild data-testid="admin-nav-back-to-app">
                  <Link href="/dashboard">
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back to App</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 group-data-[collapsible=icon]:p-2">
        <div className="flex items-center gap-3 p-2 rounded-md bg-muted group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:bg-transparent">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarImage src={user?.imageUrl || undefined} alt={firstName || "User"} />
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="text-sm font-medium truncate" data-testid="text-admin-user-name">
              {firstName} {lastName}
            </p>
            <p className="text-xs text-muted-foreground truncate" data-testid="text-admin-user-email">
              {primaryEmail}
            </p>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
