import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { LayoutDashboard, ArrowRight, RefreshCw, Plus, CalendarClock, AlertTriangle, Flame, TrendingUp, Clock, Layers, ShieldCheck, Send, Compass, FileText, CircleCheck, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useIsSignedIn } from "@/lib/dev-auth";
import { useInboxRefreshJob, refreshJobMessage } from "@/hooks/use-inbox-refresh-job";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { WorkflowStatus } from "@/components/dashboard/workflow-status";
import { useCreatePost } from "@/components/dashboard/create-post-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getPlatformMeta } from "@/lib/platforms";
import { isUsableInboxArticle } from "@/lib/inbox-quality";
import { publishingDefaults } from "@/lib/calendar";
import { buildOverviewMetrics } from "@/lib/overview-metrics";
import { fetchAllPages } from "@/lib/queryClient";
import { fetchPublishingSchedules, publishingStatus, type PublishingSchedule } from "@/lib/publishing";
import { analyticsDisplayMetric, type AnalyticsSummary } from "@shared/analytics-availability";
import type { InboxItem, Draft, UserProfile } from "@shared/schema";
import type { User as DbUser } from "@shared/models/auth";

interface TeamContext { tenantKind: string; role: string }

type ScheduledItem = PublishingSchedule;

const compactNumber = (value: number) => Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
function KpiTile({ icon: Icon, label, value, tone = "default", testId }: Readonly<{ icon: typeof Flame; label: string; value: string; tone?: "default" | "danger"; testId: string }>) {
  return <Card data-testid={testId} className={`overflow-hidden shadow-none ${tone === "danger" ? "border-destructive/30 bg-destructive/[0.03]" : "bg-card/90"}`}>
    {/* CardContent defaults to pt-0 sm:pt-0, assuming a CardHeader above it; this tile has none, so top padding needs an explicit override. */}
    <CardContent className="flex items-start justify-between gap-3 p-4 pt-4 sm:p-5 sm:pt-5">
      <div className="min-w-0">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
      </div>
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
    </CardContent>
  </Card>;
}

function NextAction({ draftCount, article, activeCount, hasCreation, onCreate }: Readonly<{ draftCount: number; article?: InboxItem; activeCount: number; hasCreation: boolean; onCreate: () => void }>) {
  if (hasCreation) return <>
    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Continue your current creation. Resuming does not generate, save or publish anything.</p>
    <Button className="mt-4" size="lg" onClick={onCreate}>Resume creation<ArrowRight className="h-4 w-4" /></Button>
  </>;
  if (draftCount > 0) return <>
    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{draftCount} draft{draftCount === 1 ? " is" : "s are"} ready to review. Pick one to edit, copy, or schedule.</p>
    <Button asChild className="mt-4" size="lg"><Link href="/dashboard/content">Review drafts<ArrowRight className="h-4 w-4" /></Link></Button>
  </>;
  if (article) return <>
    <p className="mt-2 line-clamp-2 max-w-2xl text-sm font-medium leading-relaxed">{article.headline}</p>
    {activeCount > 1 && <p className="mt-1 text-xs text-muted-foreground">{activeCount} articles ready in Discover</p>}
    <Button asChild className="mt-4" size="lg"><Link href="/dashboard/discover">Explore story<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
  </>;
  return <>
    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Start with your own idea or article. No connected account is needed to draft a post.</p>
    <Button className="mt-4" size="lg" onClick={onCreate} data-testid="button-overview-instant-review">Create post<ArrowRight className="ml-2 h-4 w-4" /></Button>
  </>;
}

function UpcomingPosts({ items, loading, error, onRetry }: Readonly<{ items: ScheduledItem[]; loading: boolean; error: boolean; onRetry: () => void }>) {
  if (loading) return <output>Loading schedule…</output>;
  if (error) return <WorkflowStatus tone="error" title="Couldn't load upcoming posts." actions={<Button variant="outline" size="sm" onClick={onRetry}>Retry schedule</Button>} />;
  if (!items.length) return <p className="text-sm text-muted-foreground">No posts scheduled. Schedule a draft when you're ready.</p>;
  return <div className="space-y-2">{items.map((item) => {
    const fallbackLabel = item.draft ? getPlatformMeta(item.draft.platform).label : "Scheduled post";
    const platforms = item.targets?.length ? item.targets.map((target) => getPlatformMeta(target.platform).label).join(" · ") : fallbackLabel;
    return <div key={item.id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><p className="truncate text-sm font-medium">{item.draft?.content.slice(0, 80) ?? "Scheduled draft"}</p><p className="text-xs text-muted-foreground">{platforms}</p></div>
      <p className="flex flex-wrap items-center gap-2 text-xs text-info"><CalendarClock className="h-4 w-4" />Scheduled · {new Date(item.scheduledPublishAt).toLocaleString()}</p>
    </div>;
  })}</div>;
}

export default function OverviewPage() {
  const { user } = useAuth();
  const isSignedIn = useIsSignedIn();
  const { openCreate, hasCreation, startNewCreate } = useCreatePost();
  const inbox = useQuery<InboxItem[]>({ queryKey: ["/api/inbox"], queryFn: ({ signal }) => fetchAllPages<InboxItem>("/api/inbox", signal), enabled: !!isSignedIn, refetchInterval: 15_000 });
  const drafts = useQuery<Draft[]>({ queryKey: ["/api/drafts"], queryFn: ({ signal }) => fetchAllPages<Draft>("/api/drafts", signal), enabled: !!isSignedIn, refetchInterval: 15_000, staleTime: 0 });
  const profileQuery = useQuery<UserProfile>({ queryKey: ["/api/profile"], enabled: !!isSignedIn });
  const profile = profileQuery.data;
  const { data: dbUser } = useQuery<DbUser | null>({ queryKey: ["/api/me"], enabled: !!isSignedIn });
  const schedules = useQuery({ queryKey: ["/api/drafts/scheduled-info"], queryFn: ({ signal }) => fetchPublishingSchedules(signal), enabled: !!isSignedIn, refetchInterval: 15_000, staleTime: 0 });
  const analytics = useQuery<AnalyticsSummary>({ queryKey: ["/api/analytics/summary"], enabled: !!isSignedIn });
  const teamContext = useQuery<TeamContext>({ queryKey: ["/api/team/context"], enabled: !!isSignedIn });
  const isTeamManager = teamContext.data?.tenantKind === "team" && ["manager", "admin", "owner"].includes(teamContext.data.role);
  const reviewQueue = useQuery<Draft[]>({ queryKey: ["/api/team/review-queue"], enabled: !!isSignedIn && isTeamManager });
  const teamMembers = useQuery<unknown[]>({ queryKey: ["/api/team/members"], enabled: !!isSignedIn && isTeamManager });
  const pendingInvitations = useQuery<unknown[]>({ queryKey: ["/api/team/invitations"], enabled: !!isSignedIn && isTeamManager });
  const refresh = useInboxRefreshJob();
  const now = new Date();
  const metrics = buildOverviewMetrics(drafts.data ?? [], schedules.data?.items ?? [], publishingDefaults(profile).timeZone, now);
  const readyDrafts = metrics.readyDrafts;
  const usableInbox = (inbox.data ?? []).filter((item) => item.status === "active" && isUsableInboxArticle(item));
  const activeItem = usableInbox[0];
  const streak = metrics.streak;
  const scheduledItems = schedules.data?.items ?? [];
  const failureCount = metrics.attentionCount;
  const upcoming = scheduledItems.filter((item) => publishingStatus(item).key === "pending")
    .sort((a, b) => new Date(a.scheduledPublishAt).getTime() - new Date(b.scheduledPublishAt).getTime()).slice(0, 3);
  const firstName = user?.firstName || dbUser?.firstName || "there";
  const isLoading = inbox.isLoading || drafts.isLoading || schedules.isLoading || profileQuery.isLoading;
  const hasError = inbox.isError || drafts.isError || schedules.isError || profileQuery.isError;

  const { avgPublishHours } = metrics;
  const timeToPublishLabel = avgPublishHours === null ? "—" : avgPublishHours < 24 ? `${avgPublishHours.toFixed(1)}h` : `${(avgPublishHours / 24).toFixed(1)}d`;
  const funnelStages = [
    { key: "discover", label: "Discover", unit: "stories", value: usableInbox.length, icon: Compass, action: "Explore stories", href: "/dashboard/discover" },
    { key: "ready", label: "Ready to review", unit: "drafts", value: readyDrafts.length, icon: FileText, action: readyDrafts.length ? "Review drafts" : "Create a post", href: readyDrafts.length ? "/dashboard/content?view=ready" : "/dashboard/create" },
    { key: "scheduled", label: "Scheduled", unit: "posts", value: metrics.scheduledCount, icon: CalendarClock, action: "Open calendar", href: "/dashboard/calendar" },
    { key: "published", label: "Published", unit: "posts · last 30 days", value: metrics.published30, icon: CircleCheck, action: "View published", href: "/dashboard/content?view=published" },
  ];
  let nextStage = "ready";
  if (!readyDrafts.length && usableInbox.length) nextStage = "discover";
  else if (!readyDrafts.length && metrics.scheduledCount) nextStage = "scheduled";
  const topPlatforms = [...metrics.platforms].sort((a, b) => b.posts - a.posts).slice(0, 5);
  const followers = analyticsDisplayMetric("followers", analytics.data?.combined?.followers, analytics.data?.availability?.followers, now);
  const engagementRate = analyticsDisplayMetric("engagementRate", analytics.data?.combined?.engagementRate, analytics.data?.availability?.engagementRate, now);
  const hasConnection = analytics.data?.connected?.linkedin || analytics.data?.connected?.twitter;
  const hasInsights = topPlatforms.length > 0 || (hasConnection && (followers.value !== null || engagementRate.value !== null)) || isTeamManager;

  return (
    <main className="flex h-full min-w-0 flex-col overflow-hidden">
      <PageHeader width="workbench" icon={LayoutDashboard} title="Home" subtitle="Your next action and upcoming posts." actions={
        (hasCreation || readyDrafts.length > 0 || activeItem || isLoading || hasError) ? <Button variant="outline" onClick={startNewCreate} data-testid="button-overview-instant-review">
          <Plus className="h-4 w-4" />New post
        </Button> : undefined
      } />
      <PageBody as="div" width="workbench" contentClassName="space-y-5 pb-10">
          <section className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Hello, {firstName}</h2>
              <p className="mt-1 text-sm text-muted-foreground">Here is what is moving and what needs your attention.</p>
            </div>
            {!isLoading && !hasError && <p className="text-sm text-muted-foreground">{now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>}
          </section>
          {!isLoading && !hasError && (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(17rem,0.75fr)]" data-testid="section-next-action-row">
            <Card data-testid="card-personalized-briefing" className="relative overflow-hidden border-primary/20 bg-gradient-to-br from-primary/[0.08] via-card to-card shadow-sm">
              <div className="pointer-events-none absolute -right-12 -top-16 size-48 rounded-full bg-primary/[0.08] blur-2xl" aria-hidden="true" />
              <CardContent className="relative grid grid-cols-1 gap-6 p-5 pt-5 sm:p-7 sm:pt-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                    Focus for today
                  </div>
                  <h2 className="mt-3 font-heading text-2xl font-semibold tracking-tight">Next action</h2>
                  <NextAction draftCount={readyDrafts.length} article={activeItem} activeCount={usableInbox.length} hasCreation={hasCreation} onCreate={hasCreation ? () => openCreate() : startNewCreate} />
                </div>
                <div className="flex flex-wrap items-center gap-3 border-t border-primary/10 pt-5 lg:max-w-64 lg:flex-col lg:items-stretch lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                  <Link href="/dashboard/discover" className="inline-flex min-h-9 items-center gap-2 rounded-md px-2 text-sm font-medium text-foreground hover:bg-primary/5">
                    <Compass className="h-4 w-4 text-primary" aria-hidden="true" />Discover articles
                  </Link>
                  <Button size="sm" variant="ghost" className="justify-start" onClick={() => void refresh.startRefresh()} disabled={refresh.isLoading || refresh.status === "unavailable"} data-testid="button-overview-refresh">
                    <RefreshCw className={`h-4 w-4 ${refresh.isLoading ? "animate-spin" : ""}`} />{refresh.isLoading ? "Refreshing…" : "Refresh articles"}
                  </Button>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-posting-streak" className="overflow-hidden shadow-none"><CardHeader className="bg-gradient-to-br from-warning-subtle to-card">
                <div className="flex items-center justify-between gap-3"><CardTitle as="h2">Posting streak</CardTitle><span className="flex size-9 items-center justify-center rounded-full bg-warning-subtle text-warning"><Flame className="h-5 w-5" /></span></div>
              </CardHeader><CardContent>
                <>
                  <p className="text-3xl font-semibold tracking-tight">{streak.current} day{streak.current === 1 ? "" : "s"}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{streak.current > 0
                    ? (streak.postedToday ? "Posted today. Keep it going tomorrow." : "Post today to keep your streak alive.")
                    : streak.longest > 0 ? `Your streak reset. Best so far: ${streak.longest} day${streak.longest === 1 ? "" : "s"}.` : "Publish your first post to start a streak."}</p>
                  {streak.longest > streak.current && <p className="mt-2 text-xs text-muted-foreground">Best streak: {streak.longest} day{streak.longest === 1 ? "" : "s"}</p>}
                </>
              </CardContent></Card>
            </div>
          )}
          {!isLoading && !hasError && <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="section-kpi-strip">
              <KpiTile testId="kpi-published" icon={Send} label="Published · this week" value={String(metrics.publishedThisWeek)} />
              <KpiTile testId="kpi-pipeline" icon={Layers} label="Drafts in pipeline" value={String(readyDrafts.length)} />
              <KpiTile testId="kpi-time-to-publish" icon={Clock} label="Avg. time to publish" value={timeToPublishLabel} />
              <KpiTile testId="kpi-attention" icon={AlertTriangle} label="Needs attention" value={String(failureCount)} tone={failureCount > 0 ? "danger" : "default"} />
            </div>
          </>}
          {isLoading && <Skeleton className="h-32 w-full" />}
          {!isLoading && hasError && (
            <WorkflowStatus tone="error" title="Couldn't load dashboard data." actions={<Button variant="outline" onClick={() => { void inbox.refetch(); void drafts.refetch(); void schedules.refetch(); void profileQuery.refetch(); }}>Try again</Button>} />
          )}
          {refresh.status !== "idle" && <WorkflowStatus tone={refresh.status === "failed" ? "error" : refresh.status === "unavailable" ? "warning" : refresh.status === "completed" ? "success" : "info"} actions={<>
            {refresh.status === "unavailable" && <Button variant="outline" size="sm" onClick={refresh.checkAgain}>Check status</Button>}
            {refresh.progress.needsSetup && <Link className="underline" href="/dashboard/discover">Set up Discover</Link>}
          </>}>{refreshJobMessage(refresh)}</WorkflowStatus>}
          {!isLoading && !hasError && <Card data-testid="card-content-funnel" className="overflow-hidden shadow-none"><CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
                <div><CardTitle as="h2">Content pipeline</CardTitle><p className="mt-1 text-sm text-muted-foreground">What's ready, what's next, and what's blocked.</p></div>
                <Button asChild variant="ghost" size="sm"><Link href="/dashboard/content?view=all">View all content<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
              </CardHeader>
                <CardContent className="space-y-4">
                  <ol aria-label="Content workflow" className="divide-y rounded-md border bg-muted/10 lg:grid lg:grid-cols-4 lg:divide-x lg:divide-y-0">
                  {funnelStages.map((stage, index) => {
                    const StageIcon = stage.icon;
                    const isNext = stage.key === nextStage;
                    return <li key={stage.key} data-testid={`pipeline-stage-${stage.key}`} data-next-action={isNext} className={`relative grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 p-4 lg:flex lg:flex-col lg:p-5 ${isNext ? "bg-primary/[0.06]" : ""}`}>
                      <div className="flex flex-wrap items-center gap-2 lg:min-h-16 lg:content-start">
                        <span className={`flex size-8 shrink-0 items-center justify-center rounded-md ${isNext ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}><StageIcon className="h-4 w-4" aria-hidden="true" /></span>
                        <h3 className="text-sm font-semibold">{stage.label}</h3>
                        {isNext && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.625rem] font-semibold text-primary">Next step</span>}
                      </div>
                      <p className="text-right lg:mt-3 lg:flex-1 lg:text-left"><span data-testid={`pipeline-count-${stage.key}`} className="block text-3xl font-semibold tabular-nums tracking-tight">{stage.value}</span><span className="mt-1 block text-xs text-muted-foreground">{stage.unit}</span></p>
                      <Button asChild variant={isNext ? "default" : "ghost"} size="sm" className="col-span-2 w-fit max-w-full lg:mt-3">
                        <Link href={stage.href}>{stage.action}<ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" /></Link>
                      </Button>
                      {index < funnelStages.length - 1 && <span className="absolute -right-3 top-9 z-10 hidden size-6 items-center justify-center rounded-full border bg-card text-muted-foreground lg:flex" aria-hidden="true"><ArrowRight className="h-3 w-3" /></span>}
                    </li>;
                  })}
                  </ol>
                  {failureCount > 0 && <div data-testid="card-attention-required" className="flex flex-col gap-3 rounded-md border border-warning/20 bg-warning-subtle p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                      <div><p className="text-sm font-semibold text-warning">{failureCount} post{failureCount === 1 ? "" : "s"} need{failureCount === 1 ? "s" : ""} attention</p><p className="mt-1 text-xs text-muted-foreground">Check failed or uncertain delivery before trying again.</p></div>
                    </div>
                    <Button asChild variant="outline" size="sm" className="w-fit shrink-0"><Link href="/dashboard/content?view=attention">Review posts<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
                  </div>}
                </CardContent>
              </Card>}
          {!isLoading && !hasError && <div className={hasInsights ? "grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(17rem,0.75fr)]" : "space-y-5"}>
            <div className="space-y-5">
              <Card data-testid="card-upcoming-publishing" className="shadow-none"><CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2"><div><CardTitle as="h2">Upcoming publishing</CardTitle><p className="mt-1 text-sm text-muted-foreground">Times shown in your local timezone.</p></div><Link href="/dashboard/calendar" className="inline-flex items-center gap-1 text-sm font-medium text-primary">Open calendar<ArrowRight className="h-4 w-4" /></Link></div>
              </CardHeader><CardContent>
                <UpcomingPosts items={upcoming} loading={schedules.isLoading} error={schedules.isError} onRetry={() => void schedules.refetch()} />
              </CardContent></Card>
            </div>
            {hasInsights && <aside className="space-y-5" aria-label="Publishing insights">
              {topPlatforms.length > 0 && <Card data-testid="card-platform-breakdown" className="shadow-none"><CardHeader><CardTitle as="h2">Published by platform</CardTitle><p className="text-xs text-muted-foreground">Last 30 days</p></CardHeader>
                <CardContent><ul className="space-y-3">{topPlatforms.map((item) => <li key={item.platform} className="flex items-center justify-between gap-3 text-sm">
                  <span>{getPlatformMeta(item.platform).label}</span><span className="rounded-md bg-muted px-2 py-0.5 font-semibold">{item.posts}</span>
                </li>)}</ul></CardContent>
              </Card>}
              {hasConnection && (followers.value !== null || engagementRate.value !== null) && <Card data-testid="card-reach-engagement" className="shadow-none">
                <CardHeader><CardTitle as="h2" className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" />Reach &amp; engagement</CardTitle></CardHeader>
                <CardContent><div className="grid grid-cols-2 gap-4">
                  <div><p className="text-xs text-muted-foreground">Followers</p><p className="mt-1 text-xl font-semibold">{followers.value !== null ? compactNumber(followers.value) : "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Engagement</p><p className="mt-1 text-xl font-semibold">{engagementRate.value !== null ? `${engagementRate.value}%` : "—"}</p></div>
                </div><p className="mt-3 text-xs leading-relaxed text-muted-foreground">From your connected LinkedIn/X account, as of the last sync.</p></CardContent>
              </Card>}
              {isTeamManager && <Card data-testid="card-team-pulse" className="shadow-none"><CardHeader><CardTitle as="h2" className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" />Team pulse</CardTitle></CardHeader>
                <CardContent><div className="grid grid-cols-3 gap-3">
                  <div><p className="text-xs text-muted-foreground">Members</p><p className="mt-1 text-xl font-semibold">{teamMembers.data?.length ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Review</p><p className="mt-1 text-xl font-semibold">{reviewQueue.data?.length ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Invites</p><p className="mt-1 text-xl font-semibold">{pendingInvitations.data?.length ?? "—"}</p></div>
                </div>{(reviewQueue.data?.length ?? 0) > 0 && <Link href="/dashboard/settings?tab=team" className="mt-3 inline-block text-sm text-primary underline">Review pending drafts</Link>}</CardContent>
              </Card>}
            </aside>}
          </div>}
          <details className="rounded-md border p-4" data-testid="optional-setup-checklist">
            <summary className="cursor-pointer text-sm font-medium">Optional setup and shortcuts</summary>
            <p className="mt-2 text-xs text-muted-foreground">These aren't requirements for creating a post. Add only what helps your workflow.</p>
            <ul className="mt-3 space-y-3 text-sm">
              <li><Link href="/dashboard/settings?tab=content" className="underline">{profile?.onboardingStatus === "completed" ? "Update your focus" : "Describe your focus"}</Link></li>
              <li><Link href="/dashboard/discover" className="underline">Choose sources and topics</Link></li>
              <li><Link href="/dashboard/connections" className="underline">Connect an account for direct publishing (optional)</Link></li>
            </ul>
          </details>
      </PageBody>
    </main>
  );
}
