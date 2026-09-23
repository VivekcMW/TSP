import { useLocation, Link } from "wouter";
import { Compass, FileText, BarChart3, LayoutDashboard, CalendarDays } from "lucide-react";
import { motion } from "framer-motion";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
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
      </SidebarContent>
      <SidebarFooter className="border-t p-2">
        <SidebarTrigger className="w-full" data-testid="button-sidebar-toggle" aria-label="Expand or collapse sidebar" />
      </SidebarFooter>
    </Sidebar>
  );
}
