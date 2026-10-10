import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { LayoutDashboard, ArrowRight, RefreshCw, Plus, CalendarClock, AlertTriangle, Flame, TrendingUp, TrendingDown, Minus, Clock, Layers, BarChart3, ShieldCheck, Send, Compass, FileText, CircleCheck, Sparkles } from "lucide-react";
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
import { computeStreak } from "@/lib/streak";
import { publishingDefaults } from "@/lib/calendar";
import { buildPublishingActivity } from "@/lib/publishing-activity";
import { analyticsDisplayMetric, type AnalyticsSummary } from "@shared/analytics-availability";
import type { InboxItem, Draft, UserProfile } from "@shared/schema";
import type { User as DbUser } from "@shared/models/auth";

interface TeamContext { tenantKind: string; role: string }

interface ScheduledItem {
  id: string;
  draftId: string;
  scheduledPublishAt: string;
  status: string;
  lastError?: string | null;
  draft?: Draft | null;
  targets?: { platform: string; status: string; lastError?: string | null }[];
}

const compactNumber = (value: number) => Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
const trendTone = (delta: number) => (delta === 0 ? "text-muted-foreground" : delta > 0 ? "text-success" : "text-destructive");
const trendIcon = (delta: number) => (delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown);

function KpiTile({ icon: Icon, label, value, trend, hint, tone = "default", testId }: Readonly<{ icon: typeof Flame; label: string; value: string; trend?: { delta: number; label: string }; hint?: string; tone?: "default" | "danger"; testId: string }>) {
  const TrendIcon = trend ? trendIcon(trend.delta) : null;
  return <Card data-testid={testId} className={`overflow-hidden shadow-none ${tone === "danger" ? "border-destructive/30 bg-destructive/[0.03]" : "bg-card/90"}`}>
    {/* CardContent defaults to pt-0 sm:pt-0, assuming a CardHeader above it; this tile has none, so top padding needs an explicit override. */}
    <CardContent className="flex items-start justify-between gap-3 p-4 pt-4 sm:p-5 sm:pt-5">
      <div className="min-w-0">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
        {trend && TrendIcon && <p className={`mt-1 flex items-center gap-1 text-xs ${trendTone(trend.delta)}`}><TrendIcon className="h-3 w-3 shrink-0" />{trend.label}</p>}
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
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
  const inbox = useQuery<InboxItem[]>({ queryKey: ["/api/inbox"], enabled: !!isSignedIn });
  const drafts = useQuery<Draft[]>({ queryKey: ["/api/drafts"], enabled: !!isSignedIn });
  const { data: profile } = useQuery<UserProfile>({ queryKey: ["/api/profile"], enabled: !!isSignedIn });
  const { data: dbUser } = useQuery<DbUser | null>({ queryKey: ["/api/me"], enabled: !!isSignedIn });
  const schedules = useQuery<{ items: ScheduledItem[] }>({ queryKey: ["/api/drafts/scheduled"], enabled: !!isSignedIn });
  const published = useQuery<Draft[]>({ queryKey: ["/api/drafts/published"], enabled: !!isSignedIn });
  const analytics = useQuery<AnalyticsSummary>({ queryKey: ["/api/analytics/summary"], enabled: !!isSignedIn });
  const teamContext = useQuery<TeamContext>({ queryKey: ["/api/team/context"], enabled: !!isSignedIn });
  const isTeamManager = teamContext.data?.tenantKind === "team" && ["manager", "admin", "owner"].includes(teamContext.data.role);
  const reviewQueue = useQuery<Draft[]>({ queryKey: ["/api/team/review-queue"], enabled: !!isSignedIn && isTeamManager });
  const teamMembers = useQuery<unknown[]>({ queryKey: ["/api/team/members"], enabled: !!isSignedIn && isTeamManager });
  const pendingInvitations = useQuery<unknown[]>({ queryKey: ["/api/team/invitations"], enabled: !!isSignedIn && isTeamManager });
  const refresh = useInboxRefreshJob();
  const readyDrafts = (drafts.data ?? []).filter((draft) => draft.publishStatus === "draft");
  const usableInbox = (inbox.data ?? []).filter((item) => item.status === "active" && isUsableInboxArticle(item));
  const activeItem = usableInbox[0];
  const streak = computeStreak((published.data ?? []).map((draft) => draft.publishedAt), publishingDefaults(profile).timeZone);
  const scheduledItems = schedules.data?.items ?? [];
  const failedSchedules = scheduledItems.filter((item) => item.status === "failed" || item.targets?.some((target) => target.status === "failed"));
  const failedDrafts = (drafts.data ?? []).filter((draft) => draft.publishStatus === "failed" && !failedSchedules.some((item) => item.draftId === draft.id));
  const failureCount = failedSchedules.length + failedDrafts.length;
  const upcoming = scheduledItems.filter((item) => item.status === "scheduled")
    .sort((a, b) => new Date(a.scheduledPublishAt).getTime() - new Date(b.scheduledPublishAt).getTime()).slice(0, 3);
  const firstName = user?.firstName || dbUser?.firstName || "there";
  const isLoading = inbox.isLoading || drafts.isLoading;
  const hasError = inbox.isError || drafts.isError;

  // KPI computations — all derived from data already fetched above, no new backend calls.
  const now = new Date();
  const lastWeek = new Date(now); lastWeek.setDate(lastWeek.getDate() - 7);
  const activity30 = buildPublishingActivity(drafts.data ?? [], 30, now);
  const activity7 = buildPublishingActivity(drafts.data ?? [], 7, now);
  const activityPrior7 = buildPublishingActivity(drafts.data ?? [], 7, lastWeek);
  const weekDelta = activity7.published.length - activityPrior7.published.length;
  const publishedWithDuration = activity30.published.filter((draft) => draft.createdAt);
  const avgPublishHours = publishedWithDuration.length
    ? publishedWithDuration.reduce((sum, draft) => sum + (new Date(draft.publishedAt!).getTime() - new Date(draft.createdAt!).getTime()), 0) / publishedWithDuration.length / 3_600_000
    : null;
  const timeToPublishLabel = avgPublishHours === null ? "—" : avgPublishHours < 24 ? `${avgPublishHours.toFixed(1)}h` : `${(avgPublishHours / 24).toFixed(1)}d`;
  const funnelStages = [
    { label: "Discover", description: "Stories ready", value: usableInbox.length, icon: Compass, href: "/dashboard/discover" },
    { label: "Drafts", description: "Ready to review", value: readyDrafts.length, icon: FileText, href: "/dashboard/content" },
    { label: "Scheduled", description: "Queued to publish", value: scheduledItems.filter((item) => item.status === "scheduled").length, icon: CalendarClock, href: "/dashboard/calendar" },
    { label: "Published", description: "Last 30 days", value: activity30.published.length, icon: CircleCheck, href: "/dashboard/content?view=published" },
  ];
  const topPlatforms = [...activity30.platforms].sort((a, b) => b.posts - a.posts).slice(0, 5);
  const followers = analyticsDisplayMetric("followers", analytics.data?.combined?.followers, analytics.data?.availability?.followers, now);
  const engagementRate = analyticsDisplayMetric("engagementRate", analytics.data?.combined?.engagementRate, analytics.data?.availability?.engagementRate, now);
  const hasConnection = analytics.data?.connected?.linkedin || analytics.data?.connected?.twitter;

  return (
    <main className="flex h-full min-w-0 flex-col overflow-hidden">
      <PageHeader width="standard" icon={LayoutDashboard} title="Home" help="Your next action and upcoming posts" actions={
        (hasCreation || readyDrafts.length > 0 || activeItem || isLoading || hasError) ? <Button variant="outline" onClick={startNewCreate} data-testid="button-overview-instant-review">
          <Plus className="h-4 w-4" />New post
        </Button> : undefined
      } />
      <PageBody as="div" width="standard" contentClassName="space-y-5 pb-10">
          <section className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Your command center</p>
              <h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Hello, {firstName}</h2>
              <p className="mt-1 text-sm text-muted-foreground">Here is what is moving and what needs your attention.</p>
            </div>
            {!isLoading && !hasError && <p className="text-sm text-muted-foreground">{now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>}
          </section>
          {!isLoading && !hasError && (
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
          )}
          {!isLoading && !hasError && <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="section-kpi-strip">
              <KpiTile testId="kpi-published" icon={Send} label="Published · this week" value={String(activity7.published.length)}
                trend={{ delta: weekDelta, label: weekDelta === 0 ? "Same as last week" : `${weekDelta > 0 ? "+" : ""}${weekDelta} vs last week` }} />
              <KpiTile testId="kpi-pipeline" icon={Layers} label="Drafts in pipeline" value={String(readyDrafts.length)} hint="Ready to review or schedule" />
              <KpiTile testId="kpi-time-to-publish" icon={Clock} label="Avg. time to publish" value={timeToPublishLabel} hint="Draft created → live · 30d" />
              <KpiTile testId="kpi-attention" icon={AlertTriangle} label="Needs attention" value={String(failureCount)} hint={failureCount ? "Failed posts to review" : "Nothing stuck right now"} tone={failureCount > 0 ? "danger" : "default"} />
            </div>
          </>}
          {isLoading && <Skeleton className="h-32 w-full" />}
          {!isLoading && hasError && (
            <WorkflowStatus tone="error" title="Couldn't load your next action." actions={<Button variant="outline" onClick={() => { void inbox.refetch(); void drafts.refetch(); }}>Try again</Button>} />
          )}
          {refresh.status !== "idle" && <WorkflowStatus tone={refresh.status === "failed" ? "error" : refresh.status === "unavailable" ? "warning" : refresh.status === "completed" ? "success" : "info"} actions={<>
            {refresh.status === "unavailable" && <Button variant="outline" size="sm" onClick={refresh.checkAgain}>Check status</Button>}
            {refresh.progress.needsSetup && <Link className="underline" href="/dashboard/discover">Set up Discover</Link>}
          </>}>{refreshJobMessage(refresh)}</WorkflowStatus>}
          {failureCount > 0 && <Card data-testid="card-attention-required"><CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2 text-destructive"><AlertTriangle className="h-4 w-4" />Publishing needs attention</CardTitle>
          </CardHeader><CardContent>
            <Link className="block text-sm text-primary underline" href="/dashboard/content?view=attention">Review {failureCount} failed post{failureCount === 1 ? "" : "s"}</Link>
          </CardContent></Card>}
          {!isLoading && !hasError && <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(17rem,0.75fr)]">
            <div className="space-y-5">
              <Card data-testid="card-content-funnel" className="shadow-none"><CardHeader className="flex-row items-start justify-between gap-4">
                <div><CardTitle as="h2" className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" />Content pipeline</CardTitle><p className="mt-1 text-sm text-muted-foreground">Move ideas from discovery to publication.</p></div>
                <Link href="/dashboard/content" className="inline-flex items-center gap-1 text-sm font-medium text-primary">View content<ArrowRight className="h-4 w-4" /></Link>
              </CardHeader>
                <CardContent><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {funnelStages.map((stage, index) => {
                    const StageIcon = stage.icon;
                    return <Link key={stage.label} href={stage.href} className="group relative rounded-lg border bg-muted/[0.18] p-4 transition-colors hover:border-primary/30 hover:bg-primary/[0.04]">
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex size-8 items-center justify-center rounded-md bg-card text-primary shadow-sm"><StageIcon className="h-4 w-4" aria-hidden="true" /></span>
                        <span className="text-2xl font-semibold tracking-tight">{stage.value}</span>
                      </div>
                      <p className="mt-4 text-sm font-semibold">{stage.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{stage.description}</p>
                      {index < funnelStages.length - 1 && <ArrowRight className="absolute -right-[1.15rem] top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 text-muted-foreground/60 lg:block" aria-hidden="true" />}
                    </Link>;
                  })}
                </div></CardContent>
              </Card>
              <Card data-testid="card-upcoming-publishing" className="shadow-none"><CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2"><div><CardTitle as="h2" className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary" />Upcoming publishing</CardTitle><p className="mt-1 text-sm text-muted-foreground">Times shown in your local timezone.</p></div><Link href="/dashboard/calendar" className="inline-flex items-center gap-1 text-sm font-medium text-primary">Open calendar<ArrowRight className="h-4 w-4" /></Link></div>
              </CardHeader><CardContent>
                <UpcomingPosts items={upcoming} loading={schedules.isLoading} error={schedules.isError} onRetry={() => void schedules.refetch()} />
              </CardContent></Card>
            </div>
            <aside className="space-y-5" aria-label="Publishing insights">
              <Card data-testid="card-posting-streak" className="overflow-hidden shadow-none"><CardHeader className="bg-gradient-to-br from-warning-subtle to-card">
                <div className="flex items-center justify-between gap-3"><CardTitle as="h2">Posting streak</CardTitle><span className="flex size-9 items-center justify-center rounded-full bg-warning-subtle text-warning"><Flame className="h-5 w-5" /></span></div>
              </CardHeader><CardContent>
                {published.isLoading ? <Skeleton className="h-10 w-32" /> : published.isError ? <p className="text-sm text-muted-foreground">Streak is unavailable right now.</p> : <>
                  <p className="text-3xl font-semibold tracking-tight">{streak.current} day{streak.current === 1 ? "" : "s"}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{streak.current > 0
                    ? (streak.postedToday ? "Posted today. Keep it going tomorrow." : "Post today to keep your streak alive.")
                    : streak.longest > 0 ? `Your streak reset. Best so far: ${streak.longest} day${streak.longest === 1 ? "" : "s"}.` : "Publish your first post to start a streak."}</p>
                  {streak.longest > streak.current && <p className="mt-2 text-xs text-muted-foreground">Best streak: {streak.longest} day{streak.longest === 1 ? "" : "s"}</p>}
                </>}
              </CardContent></Card>
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
            </aside>
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
