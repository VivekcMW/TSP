import { useLocation, Link } from "wouter";
import { Compass, FileText, BarChart3, LayoutDashboard, CalendarDays, Settings } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth, useIsSignedIn } from "@/lib/auth";
import type { User as DbUser } from "@shared/models/auth";
import { motion } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const mainNav = [
  { title: "Home", url: "/dashboard", icon: LayoutDashboard },
  { title: "Discover", url: "/dashboard/discover", icon: Compass },
  { title: "Content", url: "/dashboard/content", icon: FileText },
  { title: "Calendar", url: "/dashboard/calendar", icon: CalendarDays },
  { title: "Performance", url: "/dashboard/performance", icon: BarChart3 },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();
  const isSignedIn = useIsSignedIn();

  // Falls back to the local users row when Clerk has no loaded user — which is
  // the case under the dev login bypass. Shares App.tsx's cached "/api/me"
  // query, so this adds no request.
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
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => {
                const isActive = location === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                      data-testid={`nav-${item.title.toLowerCase()}`}
                    >
                      <Link href={item.url} className="relative" aria-current={isActive ? "page" : undefined}>
                        {isActive && (
                          <motion.div
                            layoutId="sidebar-active-pill"
                            className="absolute inset-0 rounded-md bg-sidebar-accent border-l-2 border-secondary -z-10"
                            transition={{ type: "spring", stiffness: 380, damping: 32 }}
                          />
                        )}
                        <item.icon className={`w-4 h-4 ${isActive ? "text-secondary" : ""}`} />
                        <span className={isActive ? "font-medium text-sidebar-foreground" : ""}>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="mt-auto">
          <SidebarMenu><SidebarMenuItem><SidebarMenuButton asChild tooltip="Settings" isActive={location === "/dashboard/settings"} data-testid="nav-settings"><Link href="/dashboard/settings" aria-current={location === "/dashboard/settings" ? "page" : undefined}><Settings className="h-4 w-4" /><span>Settings</span></Link></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      
      <SidebarFooter className="p-4 group-data-[collapsible=icon]:p-2">
        <div className="flex items-center gap-3 p-2 rounded-md bg-sidebar-accent group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:bg-transparent">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarImage src={user?.imageUrl || undefined} alt={firstName || "User"} />
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="text-sm font-medium truncate" data-testid="text-user-name">
              {firstName} {lastName}
            </p>
            <p className="text-xs text-muted-foreground truncate" data-testid="text-user-email">
              {primaryEmail}
            </p>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
