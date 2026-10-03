import { useLocation, Link } from "wouter";
import { Compass, FileText, LayoutDashboard, CalendarDays } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
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
      </SidebarContent>
    </Sidebar>
  );
}
