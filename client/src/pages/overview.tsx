import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  LayoutDashboard, Inbox, FileText, Sparkles, ArrowRight, ArrowUp, ArrowDown,
  RefreshCw, Link2, Puzzle, Radio, CircleCheck, Circle, Eye, TrendingUp, Users, BarChart3, CalendarClock, AlertTriangle, Flame, Plus,
} from "lucide-react";
import { FaLinkedin } from "react-icons/fa";
import { SiX } from "react-icons/si";
import { useAuth } from "@/lib/auth";
import { useIsSignedIn } from "@/lib/dev-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/dashboard/page-header";
import { InstantReviewPanel } from "@/components/dashboard/instant-review-panel";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getPlatformMeta, PLATFORMS } from "@/lib/platforms";
import type { InboxItem, Draft, UserProfile } from "@shared/schema";
import type { User as DbUser } from "@shared/models/auth";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";

interface ScheduledItem { id: string; draftId: string; scheduledPublishAt: string; status: string; lastError?: string | null; draft?: Draft | null; }
interface HotTrend { topic: string; count: number; articles: { title: string; source: string; link: string }[]; }

interface ProviderMetrics {
  account: { name: string; handle: string };
  metrics: { followers: number; impressions: number; engagements: number; engagementRate: number };
}

interface AnalyticsSummary {
  connected: { linkedin: boolean; twitter: boolean };
  combined: { followers: number; impressions: number; engagements: number; engagementRate: number; clicks: number };
  linkedin: ProviderMetrics | null;
  twitter: ProviderMetrics | null;
}

interface EnginesData {
  currentEngine: { displayName: string };
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

function formatFocus(value?: string | null): string | null {
  if (!value) return null;
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getGreeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function getBriefingMessage(source: string | undefined, article: InboxItem | undefined, keywords: string[], readyDraftCount: number, activeCount: number): string {
  if (article) {
    const topic = keywords.length ? ` on ${keywords.join(", ")}` : "";
    return `A fresh story from ${source ?? "your reading list"} is waiting for your perspective${topic}.`;
  }
  if (readyDraftCount > 0) return `You have ${readyDraftCount} draft${readyDraftCount === 1 ? "" : "s"} ready to turn into your next signal.`;
  if (activeCount > 0) return `${activeCount} relevant stor${activeCount === 1 ? "y is" : "ies are"} in your queue. Pick one and make it yours.`;
  return "Refresh Discover to find a story that fits your focus and start your next conversation.";
}

function StatCard({ label, value, icon: Icon, href, trend }: { label: string; value: number; icon: any; href: string; trend?: { delta: number } }) {
  return (
    <Link href={href}>
      <Card className="hover-elevate hover-lift cursor-pointer" data-testid={`card-stat-${label.toLowerCase()}`}>
        <CardContent className="p-5 flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-3xl font-semibold heading-dashboard mt-1">{value}</p>
            {trend && trend.delta !== 0 && (
              <p className={`text-xs flex items-center gap-1 mt-1 ${trend.delta > 0 ? "text-success" : "text-muted-foreground"}`}>
                {trend.delta > 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                {Math.abs(trend.delta)} vs last week
              </p>
            )}
          </div>
          <div className="w-10 h-10 rounded-md bg-secondary/15 flex items-center justify-center">
            <Icon className="w-5 h-5 text-secondary" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function InfoCard({ label, value, icon: Icon, href }: { label: string; value: string; icon: any; href: string }) {
  return (
    <Link href={href}>
      <Card className="hover-elevate cursor-pointer h-full" data-testid={`card-info-${label.toLowerCase().replace(/\s+/g, "-")}`}>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-secondary/15 flex items-center justify-center shrink-0">
            <Icon className="w-4 h-4 text-secondary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-sm font-medium truncate">{value}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function MetricTile({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <Card data-testid={`card-metric-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <p className="text-xl font-semibold heading-dashboard">{value}</p>
      </CardContent>
    </Card>
  );
}

function IntegrationCard({ provider, connected, data }: { provider: "linkedin" | "twitter"; connected: boolean; data: ProviderMetrics | null }) {
  const isLinkedIn = provider === "linkedin";
  return (
    <Link href="/dashboard/performance">
      <Card className="hover-elevate cursor-pointer h-full" data-testid={`card-integration-${provider}`}>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${isLinkedIn ? "bg-brand-linkedin/10" : "bg-foreground/10"}`}>
              {isLinkedIn ? <FaLinkedin className="w-4 h-4 text-brand-linkedin" /> : <SiX className="w-4 h-4" />}
            </div>
            <span className="font-medium text-sm">{isLinkedIn ? "LinkedIn" : "Twitter/X"}</span>
            <Badge variant={connected ? "default" : "secondary"} className="text-xs ml-auto">
              {connected ? "Connected" : "Not connected"}
            </Badge>
          </div>
          {connected && data ? (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Followers</p>
                <p className="font-medium">{formatNumber(data.metrics.followers)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Impressions</p>
                <p className="font-medium">{formatNumber(data.metrics.impressions)}</p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {connected ? "Sync this account to populate performance data." : "Connect to see performance here."}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

export default function OverviewPage() {
  const { user } = useAuth();
  const isSignedIn = useIsSignedIn();
  const { toast } = useToast();
  const [isInstantReviewOpen, setIsInstantReviewOpen] = useState(false);

  const { data: inboxItems, isLoading: inboxLoading } = useQuery<InboxItem[]>({
    queryKey: ["/api/inbox"],
    enabled: !!isSignedIn,
  });
  const { data: drafts, isLoading: draftsLoading } = useQuery<Draft[]>({
    queryKey: ["/api/drafts"],
    enabled: !!isSignedIn,
  });
  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
    enabled: !!isSignedIn,
  });
  const { data: dbUser } = useQuery<DbUser | null>({
    queryKey: ["/api/me"],
    enabled: !!isSignedIn,
  });
  const { data: analyticsSummary } = useQuery<AnalyticsSummary>({
    queryKey: ["/api/analytics/summary"],
    enabled: !!isSignedIn,
  });
  const { data: enginesData } = useQuery<EnginesData>({
    queryKey: ["/api/engines"],
    enabled: !!isSignedIn,
  });
  const { data: scheduledData } = useQuery<{ items: ScheduledItem[] }>({
    queryKey: ["/api/drafts/scheduled"],
    enabled: !!isSignedIn,
  });
  const { data: trends = [] } = useQuery<HotTrend[]>({ queryKey: ["/api/trends"], enabled: !!isSignedIn, staleTime: 5 * 60 * 1000 });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/inbox/refresh", { autoRefresh: false });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      toast({
        title: "Inbox refreshed",
        description: data.count === undefined ? data.message || "Your content queue is being refreshed." : `Found ${data.count} new articles based on your keywords.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to refresh",
        description: error.message || "Could not fetch new articles. Please try again.",
        variant: "destructive",
      });
    },
  });
  const addTrendMutation = useMutation({
    mutationFn: async (trend: HotTrend) => {
      const article = trend.articles[0];
      if (!article) throw new Error("No article is available for this trend");
      return (await apiRequest("POST", "/api/inbox/add-trend", { title: article.title, source: article.source, link: article.link, topic: trend.topic })).json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/inbox"] }); toast({ title: "Article added to Inbox", description: "Generate a post whenever you are ready." }); },
    onError: (error: Error) => toast({ title: "Could not add article", description: error.message, variant: "destructive" }),
  });

  const items = inboxItems || [];
  const draftsList = drafts || [];
  const activeCount = items.filter((i) => i.status === "active").length;
  const savedCount = items.filter((i) => i.status === "saved").length;
  const dismissedCount = items.filter((i) => i.status === "dismissed").length;
  const publishedCount = draftsList.filter((d) => d.publishStatus === "published").length;
  const scheduledItems = scheduledData?.items ?? [];
  const readyDrafts = draftsList.filter((draft) => draft.publishStatus === "draft");
  const failedSchedules = scheduledItems.filter((schedule) => schedule.status === "failed");
  const upcomingSchedules = scheduledItems.filter((schedule) => schedule.status === "scheduled").slice(0, 3);
  const recommendedArticle = items.find((item) => item.status === "active");
  const firstName = user?.firstName || dbUser?.firstName || "there";
  const industry = formatFocus(dbUser?.industries?.[0] ?? dbUser?.industry);
  const country = formatFocus(dbUser?.countries?.[0] ?? dbUser?.country);
  const keywords = profile?.keywords?.filter(Boolean).slice(0, 3) ?? [];
  const focusSummary = [industry, country].filter(Boolean).join(" · ");
  const greeting = getGreeting(new Date().getHours());
  const personalizedMessage = getBriefingMessage(recommendedArticle?.source, recommendedArticle, keywords, readyDrafts.length, activeCount);

  const now = Date.now();
  const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
  const draftsThisWeek = readyDrafts.filter((d) => d.createdAt && now - new Date(d.createdAt).getTime() < oneWeekMs).length;
  const draftsLastWeek = readyDrafts.filter((d) => {
    if (!d.createdAt) return false;
    const age = now - new Date(d.createdAt).getTime();
    return age >= oneWeekMs && age < oneWeekMs * 2;
  }).length;

  const enabledPlatformsCount = profile?.enabledPlatforms?.length ?? PLATFORMS.length;
  const hasLinkedIn = analyticsSummary?.connected.linkedin;
  const hasTwitter = analyticsSummary?.connected.twitter;
  const connectedLabel = hasLinkedIn && hasTwitter ? "Both connected" : hasLinkedIn ? "LinkedIn connected" : hasTwitter ? "Twitter/X connected" : "None connected";

  const checklist = [
    { label: "Complete your profile", done: profile?.onboardingStatus === "completed", href: "/dashboard/settings?tab=content" },
    { label: "Discover relevant articles", done: items.length > 0, href: "/dashboard/discover" },
    { label: "Generate your first draft", done: draftsList.length > 0, href: "/dashboard/discover" },
    { label: "Connect a publishing account", done: !!(hasLinkedIn || hasTwitter), href: "/dashboard/connections" },
  ];
  const checklistDone = checklist.every((c) => c.done);

  const recentActivity = [
    ...items.slice(0, 5).map((i) => ({
      id: `inbox-${i.id}`,
      type: "inbox" as const,
      label: i.headline,
      timestamp: i.createdAt ? new Date(i.createdAt) : new Date(),
    })),
    ...draftsList.slice(0, 5).map((d) => ({
      id: `draft-${d.id}`,
      type: "draft" as const,
      label: `${getPlatformMeta(d.platform).label} draft: ${d.content.slice(0, 60)}${d.content.length > 60 ? "…" : ""}`,
      timestamp: d.createdAt ? new Date(d.createdAt) : new Date(),
    })),
  ]
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, 8);

  const isLoading = inboxLoading || draftsLoading;
  const funnelTotal = Math.max(activeCount + savedCount + readyDrafts.length + scheduledItems.length + publishedCount, 1);
  const funnelStages = [
    { label: "Active", value: activeCount, color: "bg-primary" },
    { label: "Saved", value: savedCount, color: "bg-secondary" },
    { label: "Ready", value: readyDrafts.length, color: "bg-success" },
    { label: "Scheduled", value: scheduledItems.length, color: "bg-secondary" },
    { label: "Published", value: publishedCount, color: "bg-brand-linkedin" },
  ];
  const performanceChartData = [
    { metric: "Followers", value: analyticsSummary?.combined.followers ?? 0 },
    { metric: "Impressions", value: analyticsSummary?.combined.impressions ?? 0 },
    { metric: "Engagements", value: analyticsSummary?.combined.engagements ?? 0 },
    { metric: "Clicks", value: analyticsSummary?.combined.clicks ?? 0 },
  ];
  const contentTrendData = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (6 - index));
    const nextDay = new Date(day);
    nextDay.setDate(day.getDate() + 1);
    const inDay = (date: Date | null) => !!date && date >= day && date < nextDay;
    return {
      day: day.toLocaleDateString(undefined, { weekday: "short" }),
      drafts: draftsList.filter((draft) => inDay(draft.createdAt ?? null)).length,
      published: draftsList.filter((draft) => inDay(draft.publishedAt ?? null)).length,
    };
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        icon={LayoutDashboard}
        title="Dashboard"
        subtitle="A snapshot of your content pipeline"
        actions={
          <>
            <Button variant="outline" onClick={() => setIsInstantReviewOpen(true)} data-testid="button-overview-instant-review">
              <Link2 className="w-4 h-4 mr-2" />
              Instant Review
            </Button>
            <Button onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending} data-testid="button-overview-refresh">
              <RefreshCw className={`w-4 h-4 mr-2 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
              {refreshMutation.isPending ? "Searching..." : "Refresh Articles"}
            </Button>
          </>
        }
      />

      <main className="flex-1 p-6 overflow-y-auto">
        {!isLoading && (
          <Card className="max-w-4xl mx-auto mb-6 border-primary/20 bg-primary/[0.03]" data-testid="card-personalized-briefing">
            <CardContent className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary/15"><Sparkles className="h-5 w-5 text-secondary" /></div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-secondary">Your content brief</p>
                    <h2 className="heading-dashboard mt-1 text-xl">{greeting}, {firstName}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{focusSummary ? `Focused on ${focusSummary}.` : profile?.focusDescription || "Your personal publishing workspace is ready."}</p>
                  </div>
                </div>
                {keywords.length > 0 && <Badge variant="outline" className="border-secondary/40 text-secondary">{keywords.length} focus topics</Badge>}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
                <p className="text-sm text-foreground/80">{personalizedMessage}</p>
                <Link href={recommendedArticle ? "/dashboard/discover" : readyDrafts.length ? "/dashboard/drafts" : "/dashboard/discover"}>
                  <Button size="sm" variant="outline">{recommendedArticle ? "Explore story" : readyDrafts.length ? "Review drafts" : "Find your next story"}<ArrowRight className="ml-2 h-3.5 w-3.5" /></Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {!isLoading && trends.length > 0 && (
          <Card className="mx-auto mb-6 max-w-4xl" data-testid="card-hot-trends"><CardContent className="p-5"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><Flame className="h-4 w-4 text-secondary" /><h2 className="heading-dashboard text-base">Trending in your industry</h2></div><Link href="/dashboard/discover" className="text-sm text-primary hover:underline">Explore Discover</Link></div><div className="grid gap-2 md:grid-cols-3">{trends.slice(0, 3).map((trend) => <div key={trend.topic} className="rounded-md border p-3"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium">{trend.topic}</p><Badge variant="secondary">{trend.count}</Badge></div><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{trend.articles[0]?.title ?? "No article available"}</p><Button className="mt-3 w-full" size="sm" variant="outline" onClick={() => addTrendMutation.mutate(trend)} disabled={addTrendMutation.isPending || !trend.articles[0]}><Plus className="mr-1.5 h-3.5 w-3.5" />Add to Discover</Button></div>)}</div></CardContent></Card>
        )}

        {!isLoading && (failedSchedules.length > 0 || !hasLinkedIn) && (
          <Card className="max-w-4xl mx-auto mb-6 border-destructive/30" data-testid="card-attention-required"><CardContent className="p-4"><div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" /><h2 className="font-medium">Attention required</h2></div><div className="mt-2 space-y-1 text-sm text-muted-foreground">{failedSchedules.length > 0 && <Link className="block hover:text-foreground" href="/dashboard/drafts">{failedSchedules.length} publish failure{failedSchedules.length === 1 ? "" : "s"} need review.</Link>}{!hasLinkedIn && <Link className="block hover:text-foreground" href="/dashboard/connections">Connect LinkedIn to enable direct publishing.</Link>}</div></CardContent></Card>
        )}
        {!isLoading && !checklistDone && (
          <Card className="max-w-4xl mx-auto mb-6 border-secondary/30">
            <CardContent className="p-5">
              <h2 className="heading-dashboard text-base mb-3">Getting Started</h2>
              <div className="space-y-2">
                {checklist.map((step) => (
                  <Link key={step.label} href={step.href}>
                    <div className="flex items-center gap-2.5 text-sm hover-elevate rounded-md px-2 py-1.5 -mx-2 cursor-pointer" data-testid={`checklist-${step.label.toLowerCase().replace(/\s+/g, "-")}`}>
                      {step.done ? (
                        <CircleCheck className="w-4 h-4 text-success shrink-0" />
                      ) : (
                        <Circle className="w-4 h-4 text-muted-foreground shrink-0" />
                      )}
                      <span className={step.done ? "text-muted-foreground line-through" : ""}>{step.label}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-3 max-w-4xl mx-auto">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3 max-w-4xl mx-auto mb-4">
            <StatCard label="Active Articles" value={activeCount} icon={Inbox} href="/dashboard/discover" />
            <StatCard label="Saved Articles" value={savedCount} icon={Sparkles} href="/dashboard/discover" />
            <StatCard
              label="Drafts"
              value={readyDrafts.length}
              icon={FileText}
              href="/dashboard/drafts"
              trend={{ delta: draftsThisWeek - draftsLastWeek }}
            />
          </div>
        )}

        {!isLoading && (
          <div className="grid gap-3 md:grid-cols-3 max-w-4xl mx-auto mb-6">
            <InfoCard label="Connected Accounts" value={connectedLabel} icon={hasLinkedIn ? FaLinkedin : SiX} href="/dashboard/connections" />
            <InfoCard label="Enabled Platforms" value={`${enabledPlatformsCount} of ${PLATFORMS.length}`} icon={Puzzle} href="/dashboard/preferences" />
            <InfoCard label="Active Engine" value={enginesData?.currentEngine?.displayName ?? "—"} icon={Radio} href="/dashboard/settings?tab=content" />
          </div>
        )}

        {!isLoading && (
          <Card className="max-w-4xl mx-auto mb-6" data-testid="card-upcoming-publishing"><CardContent className="p-5"><div className="mb-3 flex items-center justify-between"><div><h2 className="heading-dashboard text-base">Upcoming publishing</h2><p className="text-sm text-muted-foreground">Your next scheduled content, shown in your local timezone.</p></div><Link href="/dashboard/drafts" className="text-sm text-primary hover:underline">Manage schedule</Link></div>{upcomingSchedules.length ? <div className="space-y-2">{upcomingSchedules.map((schedule) => <div key={schedule.id} className="flex items-center justify-between gap-4 rounded-md border p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{schedule.draft?.content.slice(0, 80) ?? "Scheduled draft"}</p><p className="text-xs text-muted-foreground">{schedule.draft ? getPlatformMeta(schedule.draft.platform).label : "Platform"}</p></div><div className="flex shrink-0 items-center gap-2 text-sm"><CalendarClock className="h-4 w-4 text-secondary" />{new Date(schedule.scheduledPublishAt).toLocaleString()}</div></div>)}</div> : <p className="py-3 text-sm text-muted-foreground">No posts are scheduled. Turn a ready draft into a timed post in one step.</p>}</CardContent></Card>
        )}

        {!isLoading && (
          <div className="max-w-4xl mx-auto mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="heading-dashboard text-base">Performance Analytics</h2>
              <Link href="/dashboard/performance" className="text-sm text-primary hover:underline flex items-center gap-1" data-testid="link-view-analytics">
                View performance <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {!hasLinkedIn && !hasTwitter ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  Connect a LinkedIn or Twitter/X account to see cumulative performance across your integrations here.
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-4 mb-3">
                  <MetricTile label="Total Followers" value={formatNumber(analyticsSummary?.combined.followers ?? 0)} icon={Users} />
                  <MetricTile label="Total Impressions" value={formatNumber(analyticsSummary?.combined.impressions ?? 0)} icon={Eye} />
                  <MetricTile label="Total Engagements" value={formatNumber(analyticsSummary?.combined.engagements ?? 0)} icon={TrendingUp} />
                  <MetricTile label="Engagement Rate" value={`${analyticsSummary?.combined.engagementRate ?? 0}%`} icon={BarChart3} />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <IntegrationCard provider="linkedin" connected={!!hasLinkedIn} data={analyticsSummary?.linkedin ?? null} />
                  <IntegrationCard provider="twitter" connected={!!hasTwitter} data={analyticsSummary?.twitter ?? null} />
                </div>
              </>
            )}
          </div>
        )}

        {!isLoading && (
          <div className="mx-auto mb-6 grid max-w-4xl gap-4 lg:grid-cols-2">
            <Card data-testid="chart-cumulative-performance"><CardContent className="p-5"><h2 className="heading-dashboard text-base">Cumulative performance</h2><p className="mb-4 text-sm text-muted-foreground">All connected-platform metrics to date.</p>{performanceChartData.some((item) => item.value > 0) ? <div className="h-56"><BarChart width={420} height={220} data={performanceChartData}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="metric" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><Tooltip /><Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} /></BarChart></div> : <p className="py-16 text-center text-sm text-muted-foreground">Connect and sync an account to populate cumulative performance.</p>}</CardContent></Card>
            <Card data-testid="chart-content-activity"><CardContent className="p-5"><h2 className="heading-dashboard text-base">Content activity</h2><p className="mb-4 text-sm text-muted-foreground">Drafts and published posts over the last seven days.</p><div className="h-56"><LineChart width={420} height={220} data={contentTrendData}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="day" tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} /><Tooltip /><Line type="monotone" dataKey="drafts" name="Drafts" stroke="hsl(var(--secondary))" strokeWidth={2} /><Line type="monotone" dataKey="published" name="Published" stroke="hsl(var(--success))" strokeWidth={2} /></LineChart></div></CardContent></Card>
          </div>
        )}

        {!isLoading && funnelTotal > 1 && (
          <Card className="max-w-4xl mx-auto mb-6">
            <CardContent className="p-5">
              <h2 className="heading-dashboard text-base mb-3">Publishing Funnel</h2>
              <div className="flex h-3 rounded-full overflow-hidden bg-muted mb-3">
                {funnelStages.map((stage) => (
                  stage.value > 0 && (
                    <div
                      key={stage.label}
                      className={stage.color}
                      style={{ width: `${(stage.value / funnelTotal) * 100}%` }}
                    />
                  )
                ))}
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                {funnelStages.map((stage) => (
                  <span key={stage.label} className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${stage.color}`} />
                    {stage.label}: {stage.value}
                  </span>
                ))}
                {dismissedCount > 0 && <span>Dismissed: {dismissedCount}</span>}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <h2 className="heading-dashboard text-lg">Recent Activity</h2>
            <Link href="/dashboard/discover" className="text-sm text-primary hover:underline flex items-center gap-1" data-testid="link-view-inbox">
              Go to Discover <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : recentActivity.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                No activity yet. Head to Discover to find articles and generate your first post.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {recentActivity.map((activity) => (
                <Card key={activity.id} className="hover-elevate">
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Badge variant={activity.type === "inbox" ? "secondary" : "outline"} className="shrink-0 capitalize">
                        {activity.type === "inbox" ? "Article" : "Draft"}
                      </Badge>
                      <p className="text-sm truncate">{activity.label}</p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {activity.timestamp.toLocaleDateString()}
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>

      <InstantReviewPanel isOpen={isInstantReviewOpen} onClose={() => setIsInstantReviewOpen(false)} />
    </div>
  );
}

