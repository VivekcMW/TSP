import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Inbox, RefreshCw, Link2, AlertTriangle, Rss } from "lucide-react";
import { useAuth, useIsSignedIn } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useInboxRefresh } from "@/hooks/use-inbox-refresh";
import { InboxRefreshProgress } from "@/components/dashboard/inbox-refresh-progress";
import { InboxListRow } from "@/components/dashboard/inbox-list-row";
import { InboxDetail } from "@/components/dashboard/inbox-detail";
import { PostGeneratorModal } from "@/components/dashboard/post-generator-modal";
import { InstantReviewPanel } from "@/components/dashboard/instant-review-panel";
import { SourcesManagerContent } from "@/components/dashboard/sources-manager";
import { PageHeader } from "@/components/dashboard/page-header";
import { DashboardEmptyState } from "@/components/dashboard/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import type { InboxItem } from "@shared/schema";

type FilterType = "all" | "saved" | "dismissed";

export default function DashboardPage() {
  const { user } = useAuth();
  const isSignedIn = useIsSignedIn();
  const { toast } = useToast();
  const [filter, setFilter] = useState<FilterType>("all");
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isInstantReviewOpen, setIsInstantReviewOpen] = useState(false);
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isDetailSheetOpen, setIsDetailSheetOpen] = useState(false);

  const { data: inboxItems, isLoading, isError, error, refetch } = useQuery<InboxItem[]>({
    queryKey: ["/api/inbox"],
    enabled: !!isSignedIn,
  });
  
  const openLinkedInShare = (content: string, articleUrl?: string) => {
    navigator.clipboard.writeText(content);
    toast({
      title: "Content copied!",
      description: "Paste your post content into LinkedIn.",
    });
    
    const linkedInUrl = articleUrl 
      ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(articleUrl)}`
      : "https://www.linkedin.com/feed/?shareActive=true";
    window.open(linkedInUrl, "_blank");
  };

  const refreshInbox = useInboxRefresh({
    onComplete: () => queryClient.invalidateQueries({ queryKey: ["/api/inbox"] }),
  });
  const { needsSetup } = refreshInbox;

  useEffect(() => {
    if (!user) return;
    const sessionKey = `inbox_refreshed_${user.id}`;
    if (!sessionStorage.getItem(sessionKey)) {
      sessionStorage.setItem(sessionKey, "1");
      refreshInbox.startRefresh(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const saveDraftMutation = useMutation({
    mutationFn: async (data: { inboxItemId?: string; platform: string; tone: string; content: string }) => {
      const res = await apiRequest("POST", "/api/drafts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drafts"] });
      toast({
        title: "Draft saved",
        description: "Find it in your Drafts tab.",
      });
    },
    onError: () => {
      toast({
        title: "Failed to save draft",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const items = inboxItems || [];
  const filteredItems = items.filter(item => {
    if (filter === "all") return item.status === "active";
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

  const selectRelative = (delta: number) => {
    if (!activeItem) return;
    const index = filteredItems.findIndex((i) => i.id === activeItem.id);
    const nextIndex = Math.min(Math.max(index + delta, 0), filteredItems.length - 1);
    setActiveId(filteredItems[nextIndex].id);
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
    },
    onError: () => {
      toast({
        title: "Failed to update",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleGeneratePost = (item: InboxItem) => {
    setSelectedItem(item);
    setIsModalOpen(true);
  };

  const handleSave = (item: InboxItem) => {
    advanceSelectionPast(item.id);
    updateInboxItemMutation.mutate({ id: item.id, status: "saved" });
    toast({
      title: "Article saved",
      description: "You can find it in your Saved tab.",
    });
  };

  const handleDismiss = (item: InboxItem) => {
    advanceSelectionPast(item.id);
    updateInboxItemMutation.mutate({ id: item.id, status: "dismissed" });
    toast({
      title: "Article dismissed",
      description: "We'll learn from this to improve your recommendations.",
    });
  };

  const handleSaveDraft = (platform: string, tone: string, content: string) => {
    saveDraftMutation.mutate({
      inboxItemId: selectedItem?.id,
      platform,
      tone,
      content,
    });
    setIsModalOpen(false);
  };

  const handlePost = (platform: string, tone: string, content: string) => {
    if (platform === "linkedin") {
      const articleUrl = selectedItem?.articleUrl;
      openLinkedInShare(content, articleUrl);
      setIsModalOpen(false);
    } else {
      // Twitter/X - copy and open in new tab
      navigator.clipboard.writeText(content);
      toast({
        title: "Content copied!",
        description: "Paste your post content into Twitter/X.",
      });
      window.open("https://twitter.com/compose/tweet", "_blank");
      setIsModalOpen(false);
    }
  };

  const activeCount = items.filter((i) => i.status === "active").length;
  const savedCount = items.filter((i) => i.status === "saved").length;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (isModalOpen || isInstantReviewOpen || isSourcesOpen || isDetailSheetOpen) return;
      if (!activeItem) return;

      switch (event.key.toLowerCase()) {
        case "j":
        case "arrowdown":
          event.preventDefault();
          selectRelative(1);
          break;
        case "k":
        case "arrowup":
          event.preventDefault();
          selectRelative(-1);
          break;
        case "s":
          event.preventDefault();
          handleSave(activeItem);
          break;
        case "d":
          event.preventDefault();
          handleDismiss(activeItem);
          break;
        case "g":
        case "enter":
          event.preventDefault();
          handleGeneratePost(activeItem);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeItem, filteredItems, isModalOpen, isInstantReviewOpen, isSourcesOpen, isDetailSheetOpen]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        icon={Inbox}
        title="Discover"
        subtitle={`${filteredItems.length} articles curated from your own sources and interests`}
        stats={
          <>
            <Badge variant="outline" className="text-xs font-normal">{activeCount} active</Badge>
            <Badge variant="outline" className="text-xs font-normal">{savedCount} saved</Badge>
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => setIsSourcesOpen(true)}
              data-testid="button-manage-sources"
            >
              <Rss className="w-4 h-4 mr-2" />
              Manage Sources
            </Button>
            <Button
              variant="outline"
              onClick={() => setIsInstantReviewOpen(true)}
              data-testid="button-instant-review"
            >
              <Link2 className="w-4 h-4 mr-2" />
              Instant Review
            </Button>
            <Button
              variant="default"
              onClick={() => refreshInbox.startRefresh(false)}
              disabled={refreshInbox.isLoading}
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
      
      <main className="flex-1 overflow-hidden">
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
              title={filter === "all" && needsSetup ? "Tell us what you're interested in" : "No articles yet"}
              description={
                filter === "all"
                  ? needsSetup
                    ? "Discover is 100% driven by your own interests — add keywords, companies, influencers, or a custom source in your profile, then refresh."
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
                      onClick={() => refreshInbox.startRefresh(false)}
                      disabled={refreshInbox.isLoading}
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
      
      <PostGeneratorModal
        item={selectedItem}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSaveDraft={handleSaveDraft}
        onPost={handlePost}
      />
      
      <InstantReviewPanel
        isOpen={isInstantReviewOpen}
        onClose={() => setIsInstantReviewOpen(false)}
      />

      <Sheet open={isSourcesOpen} onOpenChange={setIsSourcesOpen}>
        <SheetContent side="right" className="w-full sm:max-w-[500px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Manage Sources</SheetTitle>
            <SheetDescription>Add as many blogs, publications, or sites as you want — Discover fetches only from what you add here plus live search on your own keywords, companies, and influencers. No pre-configured sources.</SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            <SourcesManagerContent />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={isDetailSheetOpen} onOpenChange={setIsDetailSheetOpen}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-lg">
          {activeItem && (
            <InboxDetail
              item={activeItem}
              onGeneratePost={(item) => { setIsDetailSheetOpen(false); handleGeneratePost(item); }}
              onSave={(item) => { setIsDetailSheetOpen(false); handleSave(item); }}
              onDismiss={(item) => { setIsDetailSheetOpen(false); handleDismiss(item); }}
            />
          )}
        </SheetContent>
      </Sheet>

      <InboxRefreshProgress
        isVisible={!refreshInbox.isSilent}
        isLoading={refreshInbox.isLoading}
        progress={refreshInbox.progress}
        error={refreshInbox.error}
        jobStatus={refreshInbox.jobStatus === "active" || refreshInbox.jobStatus === "delayed" || refreshInbox.jobStatus === "waiting" ? "active" : refreshInbox.jobStatus}
        onDismiss={refreshInbox.reset}
      />
    </div>
  );
}
