import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { LayoutDashboard, Sparkles, ArrowRight, RefreshCw, Plus, CalendarClock, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useIsSignedIn } from "@/lib/dev-auth";
import { useInboxRefreshJob, refreshJobMessage } from "@/hooks/use-inbox-refresh-job";
import { PageHeader } from "@/components/dashboard/page-header";
import { useCreatePost } from "@/components/dashboard/create-post-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getPlatformMeta } from "@/lib/platforms";
import { isUsableInboxArticle } from "@/lib/inbox-quality";
import type { InboxItem, Draft, UserProfile } from "@shared/schema";
import type { User as DbUser } from "@shared/models/auth";

interface ScheduledItem {
  id: string;
  draftId: string;
  scheduledPublishAt: string;
  status: string;
  lastError?: string | null;
  draft?: Draft | null;
  targets?: { platform: string; status: string; lastError?: string | null }[];
}

function NextAction({ draftCount, article, onCreate }: Readonly<{ draftCount: number; article?: InboxItem; onCreate: () => void }>) {
  if (draftCount > 0) return <>
    <p className="mt-2 text-sm text-muted-foreground">{draftCount} draft{draftCount === 1 ? " is" : "s are"} ready to review. Pick one to edit, copy, or schedule.</p>
    <Button asChild className="mt-3"><Link href="/dashboard/drafts">Review drafts<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
  </>;
  if (article) return <>
    <p className="mt-2 line-clamp-2 text-sm">{article.headline}</p>
    <Button asChild className="mt-3"><Link href="/dashboard/discover">Explore story<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
  </>;
  return <>
    <p className="mt-2 text-sm text-muted-foreground">Start with your own idea or article. No connected account is needed to draft a post.</p>
    <Button className="mt-3" onClick={onCreate}>Create post<ArrowRight className="ml-2 h-4 w-4" /></Button>
  </>;
}

function UpcomingPosts({ items, loading, error, onRetry }: Readonly<{ items: ScheduledItem[]; loading: boolean; error: boolean; onRetry: () => void }>) {
  if (loading) return <output>Loading schedule…</output>;
  if (error) return <div role="alert"><p>Couldn't load upcoming posts.</p><Button variant="outline" size="sm" onClick={onRetry}>Retry schedule</Button></div>;
  if (!items.length) return <p className="text-sm text-muted-foreground">No posts scheduled. Schedule a draft when you're ready.</p>;
  return <div className="space-y-2">{items.map((item) => {
    const fallbackLabel = item.draft ? getPlatformMeta(item.draft.platform).label : "Scheduled post";
    const platforms = item.targets?.length ? item.targets.map((target) => getPlatformMeta(target.platform).label).join(" · ") : fallbackLabel;
    return <div key={item.id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><p className="truncate text-sm font-medium">{item.draft?.content.slice(0, 80) ?? "Scheduled draft"}</p><p className="text-xs text-muted-foreground">{platforms}</p></div>
      <p className="flex shrink-0 items-center gap-2 text-xs"><CalendarClock className="h-4 w-4 text-secondary" />{new Date(item.scheduledPublishAt).toLocaleString()}</p>
    </div>;
  })}</div>;
}

export default function OverviewPage() {
  const { user } = useAuth();
  const isSignedIn = useIsSignedIn();
  const { openCreate } = useCreatePost();
  const inbox = useQuery<InboxItem[]>({ queryKey: ["/api/inbox"], enabled: !!isSignedIn });
  const drafts = useQuery<Draft[]>({ queryKey: ["/api/drafts"], enabled: !!isSignedIn });
  const { data: profile } = useQuery<UserProfile>({ queryKey: ["/api/profile"], enabled: !!isSignedIn });
  const { data: dbUser } = useQuery<DbUser | null>({ queryKey: ["/api/me"], enabled: !!isSignedIn });
  const schedules = useQuery<{ items: ScheduledItem[] }>({ queryKey: ["/api/drafts/scheduled"], enabled: !!isSignedIn });
  const refresh = useInboxRefreshJob();
  const readyDrafts = (drafts.data ?? []).filter((draft) => draft.publishStatus === "draft");
  const activeItem = inbox.data?.find((item) => item.status === "active" && isUsableInboxArticle(item));
  const scheduledItems = schedules.data?.items ?? [];
  const failedSchedules = scheduledItems.filter((item) => item.status === "failed" || item.targets?.some((target) => target.status === "failed"));
  const failedDrafts = (drafts.data ?? []).filter((draft) => draft.publishStatus === "failed" && !failedSchedules.some((item) => item.draftId === draft.id));
  const failureCount = failedSchedules.length + failedDrafts.length;
  const upcoming = scheduledItems.filter((item) => item.status === "scheduled")
    .sort((a, b) => new Date(a.scheduledPublishAt).getTime() - new Date(b.scheduledPublishAt).getTime()).slice(0, 3);
  const firstName = user?.firstName || dbUser?.firstName || "there";
  const isLoading = inbox.isLoading || drafts.isLoading;
  const hasError = inbox.isError || drafts.isError;

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <PageHeader icon={LayoutDashboard} title="Home" subtitle="Your next action and upcoming posts" actions={
        <Button variant="outline" onClick={() => openCreate()} data-testid="button-overview-instant-review">
          <Plus className="mr-2 h-4 w-4" />Create post
        </Button>
      } />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          <h2 className="heading-dashboard text-xl">Hello, {firstName}</h2>
          {isLoading && <Skeleton className="h-32 w-full" />}
          {!isLoading && hasError && (
            <Card><CardContent className="p-5" role="alert"><p>Couldn't load your next action.</p><Button variant="outline" className="mt-3" onClick={() => { void inbox.refetch(); void drafts.refetch(); }}>Try again</Button></CardContent></Card>
          )}
          {!isLoading && !hasError && (
            <Card className="border-primary/20" data-testid="card-personalized-briefing"><CardContent className="p-5">
              <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-secondary" /><h3 className="font-medium">Next action</h3></div>
              <NextAction draftCount={readyDrafts.length} article={activeItem} onCreate={() => openCreate()} />
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-3">
                <Link href="/dashboard/discover" className="text-sm text-primary underline">Discover articles</Link>
                <Button size="sm" variant="ghost" onClick={() => void refresh.startRefresh()} disabled={refresh.isLoading || refresh.status === "unavailable"} data-testid="button-overview-refresh">
                  <RefreshCw className={`mr-2 h-4 w-4 ${refresh.isLoading ? "animate-spin" : ""}`} />{refresh.isLoading ? "Refreshing…" : "Refresh articles"}
                </Button>
              </div>
            </CardContent></Card>
          )}
          {refresh.status !== "idle" && <div className="rounded-md border p-4 text-sm">
            {refresh.status === "failed" ? <p role="alert">{refreshJobMessage(refresh)}</p> : <output aria-live="polite">{refreshJobMessage(refresh)}</output>}
            {refresh.status === "unavailable" && <Button variant="outline" size="sm" className="ml-2" onClick={refresh.checkAgain}>Check status</Button>}
            {refresh.progress.needsSetup && <Link className="ml-2 underline" href="/dashboard/discover">Set up Discover</Link>}
          </div>}
          {failureCount > 0 && <Card className="border-destructive/30" data-testid="card-attention-required"><CardContent className="p-4">
            <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" /><h3 className="font-medium">Publishing needs attention</h3></div>
            <Link className="mt-2 block text-sm underline" href="/dashboard/drafts">Review {failureCount} failed post{failureCount === 1 ? "" : "s"}</Link>
          </CardContent></Card>}
          <Card data-testid="card-upcoming-publishing"><CardContent className="p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="heading-dashboard text-base">Upcoming publishing</h3><p className="text-xs text-muted-foreground">Times shown in your local timezone.</p></div><Link href="/dashboard/calendar" className="text-sm underline">Open calendar</Link></div>
            <UpcomingPosts items={upcoming} loading={schedules.isLoading} error={schedules.isError} onRetry={() => void schedules.refetch()} />
          </CardContent></Card>
          <details className="rounded-md border p-4" data-testid="optional-setup-checklist">
            <summary className="cursor-pointer text-sm font-medium">Optional setup and shortcuts</summary>
            <p className="mt-2 text-xs text-muted-foreground">These aren't requirements for creating a post. Add only what helps your workflow.</p>
            <ul className="mt-3 space-y-3 text-sm">
              <li><Link href="/dashboard/settings?tab=content" className="underline">{profile?.onboardingStatus === "completed" ? "Update your focus" : "Describe your focus"}</Link></li>
              <li><Link href="/dashboard/discover" className="underline">Choose sources and topics</Link></li>
              <li><Link href="/dashboard/connections" className="underline">Connect an account for direct publishing (optional)</Link></li>
              <li><Link href="/dashboard/performance" className="underline" data-testid="link-view-analytics">View publishing performance</Link></li>
            </ul>
          </details>
        </div>
      </main>
    </div>
  );
}

