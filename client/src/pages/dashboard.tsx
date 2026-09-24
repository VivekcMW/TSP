import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Inbox, RefreshCw, AlertTriangle } from "lucide-react";
import { useIsSignedIn } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useInboxRefreshJob, refreshJobMessage } from "@/hooks/use-inbox-refresh-job";
import { InboxListRow } from "@/components/dashboard/inbox-list-row";
import { InboxDetail } from "@/components/dashboard/inbox-detail";
import { PersonalTrends } from "@/components/dashboard/personal-trends";
import { useCreatePost } from "@/components/dashboard/create-post-provider";
import { PageHeader } from "@/components/dashboard/page-header";
import { DashboardEmptyState } from "@/components/dashboard/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import type { InboxItem } from "@shared/schema";

type FilterType = "all" | "saved" | "dismissed";

export default function DashboardPage() {
  const isSignedIn = useIsSignedIn();
  const { toast } = useToast();
  const [filter, setFilter] = useState<FilterType>("all");
  const { openCreate } = useCreatePost();
  const triageLock = useRef(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isDetailSheetOpen, setIsDetailSheetOpen] = useState(false);

  const history = useQuery<InboxItem[]>({
    queryKey: ["/api/inbox"],
    enabled: !!isSignedIn,
  });
  const active = useQuery<InboxItem[]>({
    queryKey: ["/api/inbox", "active"],
    queryFn: async ({ signal }) => (await apiRequest("GET", "/api/inbox?status=active", undefined, { signal })).json(),
    enabled: !!isSignedIn,
  });
  const { isLoading, isError, error, refetch } = filter === "all" ? active : history;

  const refreshInbox = useInboxRefreshJob();
  const needsSetup = refreshInbox.progress.needsSetup;

  useEffect(() => {
    if (refreshInbox.status !== "completed") return;
    setFilter("all");
    void active.refetch();
    void history.refetch();
  }, [refreshInbox.status]);

  const items = history.data || [];
  // Legacy active rows still occupy capacity: keep them visible and actionable.
  const activeCandidates = (active.data || []).filter(item => item.status === "active");
  const filteredItems = filter === "all" ? activeCandidates : items.filter(item => {
    if (filter === "saved") return item.status === "saved";
    if (filter === "dismissed") return item.status === "dismissed";
    return true;
  });
  const activeItem = filteredItems.find((i) => i.id === activeId) ?? null;

  useEffect(() => {
    if (!activeItem && filteredItems.length > 0) {
      setActiveId(filteredItems[0].id);
    }
  }, [activeItem, filteredItems]);

  const advanceSelectionPast = (removedId: string) => {
    const currentIndex = filteredItems.findIndex((i) => i.id === removedId);
    const remaining = filteredItems.filter((i) => i.id !== removedId);
    if (remaining.length === 0) {
      setActiveId(null);
      return;
    }
    const nextIndex = Math.min(currentIndex, remaining.length - 1);
    setActiveId(remaining[nextIndex].id);
  };

  const handleSelectRow = (item: InboxItem) => {
    setActiveId(item.id);
    if (window.innerWidth < 1024) setIsDetailSheetOpen(true);
  };

  const updateInboxItemMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/inbox/${id}`, { status });
      return res.json();
    },
    onSuccess: (_data, { id, status }) => {
      // Only commit triage and advance after the API acknowledges the change.
      queryClient.setQueryData<InboxItem[]>(["/api/inbox"], current => current?.map(item => item.id === id ? { ...item, status } : item));
      queryClient.setQueryData<InboxItem[]>(["/api/inbox", "active"], current => current?.filter(item => item.id !== id));
      if (activeId === id) advanceSelectionPast(id);
      setIsDetailSheetOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      toast({ title: status === "saved" ? "Story saved" : "Story dismissed", description: status === "saved" ? "Find it in Saved stories." : "Removed from your active stories." });
    },
    onError: () => {
      toast({
        title: "Failed to update",
        description: "Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => { triageLock.current = false; },
  });

  const handleGeneratePost = (item: InboxItem) => { setIsDetailSheetOpen(false); openCreate(item); };
  const triage = (item: InboxItem, status: "saved" | "dismissed") => {
    if (triageLock.current || item.status === status) return;
    triageLock.current = true;
    updateInboxItemMutation.mutate({ id: item.id, status });
  };
  const handleSave = (item: InboxItem) => triage(item, "saved");
  const handleDismiss = (item: InboxItem) => triage(item, "dismissed");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        icon={Inbox}
        title="Discover"
        subtitle={`${filteredItems.length} articles curated from your own sources and interests`}
        actions={
          <>
            <Button
              variant="default"
              onClick={() => void refreshInbox.startRefresh()}
              disabled={refreshInbox.isLoading || refreshInbox.status === "unavailable"}
              data-testid="button-refresh-inbox"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${refreshInbox.isLoading ? "animate-spin" : ""}`} />
              {refreshInbox.isLoading ? "Searching..." : "Refresh Articles"}
            </Button>
            <div className="flex bg-muted rounded-md p-1">
              {(["all", "saved", "dismissed"] as FilterType[]).map((f) => (
                <Button
                  key={f}
                  variant={filter === f ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setFilter(f)}
                  className="capitalize"
                  data-testid={`button-filter-${f}`}
                >
                  {f}
                </Button>
              ))}
            </div>
          </>
        }
      />

      <PersonalTrends />
      <main className="min-h-0 flex-1 overflow-hidden">
        {isLoading ? (
          <div className="grid gap-4 p-6">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 w-full max-w-3xl rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-6">
            <DashboardEmptyState
              icon={AlertTriangle}
              title="Discover is taking a breather"
              description={error instanceof Error ? error.message : "We couldn't load your articles right now."}
              action={<Button onClick={() => refetch()}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button>}
            />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-6">
            <DashboardEmptyState
              icon={Inbox}
              title={filter === "all" && needsSetup ? "Tell us what you're interested in"
                : filter === "all" && refreshInbox.isLoading ? "Finding your stories" : "No articles yet"}
              description={
                filter === "all"
                  ? needsSetup
                    ? "Discover is 100% driven by your own interests — add keywords, companies, influencers, or a custom source in your profile, then refresh."
                    : refreshInbox.isLoading
                      ? "Searching your sources and topics now. New stories appear here in about a minute."
                      : "Click 'Refresh Articles' to search for content based on your keywords, companies, influencers, and sources."
                  : `No ${filter} articles found.`
              }
              action={
                filter === "all" && (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {needsSetup && (
                      <Link href="/dashboard/settings?tab=content">
                        <Button variant="outline">Set up your interests</Button>
                      </Link>
                    )}
                    <Button
                      onClick={() => void refreshInbox.startRefresh()}
                      disabled={refreshInbox.isLoading || refreshInbox.status === "unavailable"}
                      data-testid="button-refresh-empty"
                    >
                      <RefreshCw className={`w-4 h-4 mr-2 ${refreshInbox.isLoading ? "animate-spin" : ""}`} />
                      {refreshInbox.isLoading ? "Searching..." : "Refresh Articles"}
                    </Button>
                  </div>
                )
              }
            />
          </div>
        ) : (
          <div className="flex h-full">
            <div className="w-full overflow-y-auto lg:w-[380px] lg:shrink-0 lg:border-r">
              {filteredItems.map((item) => (
                <InboxListRow
                  key={item.id}
                  item={item}
                  isActive={item.id === activeItem?.id}
                  onSelect={() => handleSelectRow(item)}
                />
              ))}
            </div>
            <div className="hidden flex-1 lg:block">
              {activeItem && (
                <InboxDetail
                  item={activeItem}
                  onGeneratePost={handleGeneratePost}
                  onSave={handleSave}
                  onDismiss={handleDismiss}
                />
              )}
            </div>
          </div>
        )}
      </main>
      
      <Sheet open={isDetailSheetOpen} onOpenChange={setIsDetailSheetOpen}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-lg">
          <SheetHeader className="sr-only"><SheetTitle>Story details</SheetTitle><SheetDescription>Review a story, save it, dismiss it, or create a draft.</SheetDescription></SheetHeader>
          {activeItem && (
            <InboxDetail
              item={activeItem}
              onGeneratePost={(item) => { setIsDetailSheetOpen(false); handleGeneratePost(item); }}
              onSave={handleSave}
              onDismiss={handleDismiss}
            />
          )}
        </SheetContent>
      </Sheet>

      {refreshInbox.status !== "idle" && <div className="flex flex-wrap items-center gap-2 border-t p-3 text-sm"><output>{refreshJobMessage(refreshInbox)}</output>{refreshInbox.status === "unavailable" && <Button variant="outline" onClick={refreshInbox.checkAgain}>Check refresh status</Button>}</div>}
    </div>
  );
}
