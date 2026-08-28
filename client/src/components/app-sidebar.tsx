import { useLocation, Link } from "wouter";
import { Inbox, FileText, Send, Settings, Zap, LogOut, BarChart3, UserCog, TrendingUp, Flame } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useClerk, useUser } from "@clerk/react";
import { useIsSignedIn } from "@/lib/dev-auth";
import type { User as DbUser } from "@shared/models/auth";
import { motion } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const mainNav = [
  { title: "Inbox", url: "/dashboard", icon: Inbox },
  { title: "Drafts", url: "/dashboard/drafts", icon: FileText },
  { title: "Published", url: "/dashboard/published", icon: Send },
  { title: "Analytics", url: "/dashboard/analytics", icon: BarChart3 },
];

const settingsNav = [
  { title: "Profile Settings", url: "/dashboard/profile", icon: UserCog },
  { title: "Settings", url: "/dashboard/settings", icon: Settings },
];

interface HotTrend {
  topic: string;
  count: number;
  articles: { title: string; source: string; link: string }[];
}

export function AppSidebar() {
  const [location] = useLocation();
  const { user } = useUser();
  const isSignedIn = useIsSignedIn();
  const { signOut } = useClerk();
  const { toast } = useToast();

  const { data: trends, isLoading: trendsLoading } = useQuery<HotTrend[]>({
    queryKey: ["/api/trends"],
    enabled: !!isSignedIn,
    staleTime: 5 * 60 * 1000,
  });

  const addTrendMutation = useMutation({
    mutationFn: async (data: { title: string; source: string; link: string; topic: string }) => {
      const res = await apiRequest("POST", "/api/inbox/add-trend", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      if (!data.alreadyExists) {
        toast({
          title: "Article added to inbox",
          description: "You can now generate posts from this article.",
        });
      }
    },
    onError: () => {
      toast({
        title: "Could not add article",
        description: "The article URL may be invalid or unreachable.",
        variant: "destructive",
      });
    },
  });

  const handleTrendClick = (trend: HotTrend, e: React.MouseEvent) => {
    const article = trend.articles[0];
    if (!article?.link) return;
    
    addTrendMutation.mutate({
      title: article.title,
      source: article.source,
      link: article.link,
      topic: trend.topic,
    });
  };

  // Falls back to the local users row when Clerk has no loaded user — which is
  // the case under the dev login bypass. Shares App.tsx's cached "/api/me"
  // query, so this adds no request.
  const { data: dbUser } = useQuery<DbUser>({
    queryKey: ["/api/me"],
    enabled: isSignedIn,
  });

  const firstName = user?.firstName ?? dbUser?.firstName ?? "";
  const lastName = user?.lastName ?? dbUser?.lastName ?? "";
  const primaryEmail = user?.primaryEmailAddress?.emailAddress ?? dbUser?.email;
  const initials = firstName && lastName
    ? `${firstName[0]}${lastName[0]}`
    : primaryEmail?.[0]?.toUpperCase() || "U";

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/dashboard" className="flex items-center gap-1">
          <Zap className="w-6 h-6 text-primary fill-primary" />
          <span className="font-bold text-lg text-primary">TheSocialPundit</span>
        </Link>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === item.url}
                    data-testid={`nav-${item.title.toLowerCase()}`}
                  >
                    <Link href={item.url} className="relative">
                      {location === item.url && (
                        <motion.div
                          layoutId="sidebar-active-pill"
                          className="absolute inset-0 rounded-md bg-sidebar-primary/10 -z-10"
                          transition={{ type: "spring", stiffness: 380, damping: 32 }}
                        />
                      )}
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        
        <SidebarGroup>
          <SidebarGroupLabel>Account</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === item.url}
                    data-testid={`nav-${item.title.toLowerCase()}`}
                  >
                    <Link href={item.url} className="relative">
                      {location === item.url && (
                        <motion.div
                          layoutId="sidebar-active-pill"
                          className="absolute inset-0 rounded-md bg-sidebar-primary/10 -z-10"
                          transition={{ type: "spring", stiffness: 380, damping: 32 }}
                        />
                      )}
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center gap-2">
            <Flame className="w-3 h-3 text-secondary" />
            Hot Trends
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="px-2 space-y-1">
              {trendsLoading ? (
                <div className="space-y-1">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-6 w-full" />
                  ))}
                </div>
              ) : trends && trends.length > 0 ? (
                trends.map((trend, index) => (
                  <a 
                    key={trend.topic}
                    href={trend.articles[0]?.link || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm hover-elevate cursor-pointer"
                    data-testid={`trend-${index}`}
                    onClick={(e) => handleTrendClick(trend, e)}
                  >
                    <span className="truncate text-sidebar-foreground/90 hover:text-sidebar-foreground">{trend.topic}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                      {trend.count}
                    </Badge>
                  </a>
                ))
              ) : (
                <p className="text-xs text-muted-foreground px-2">
                  No trends available
                </p>
              )}
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      
      <SidebarFooter className="p-4">
        <div className="flex items-center gap-3 p-2 rounded-md bg-sidebar-accent">
          <Avatar className="h-8 w-8">
            <AvatarImage src={user?.imageUrl || undefined} alt={firstName || "User"} />
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" data-testid="text-user-name">
              {firstName} {lastName}
            </p>
            <p className="text-xs text-muted-foreground truncate" data-testid="text-user-email">
              {primaryEmail}
            </p>
            <button 
              onClick={() => signOut({ redirectUrl: "/" })}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
              data-testid="button-logout"
            >
              Log Out
            </button>
          </div>
          <button 
            onClick={() => signOut({ redirectUrl: "/" })}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
            data-testid="button-logout-icon"
            aria-label="Log out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
