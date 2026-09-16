import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileText, Search, Send, ExternalLink, CalendarClock, CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useIsSignedIn } from "@/lib/dev-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getPlatformMeta, PLATFORMS } from "@/lib/platforms";
import { PageHeader } from "@/components/dashboard/page-header";
import { DashboardEmptyState } from "@/components/dashboard/empty-state";
import { ScheduleArticleModal } from "@/components/schedule-article-modal";
import { DraftCard, type DraftScheduleInfo } from "@/components/dashboard/draft-card";
import { usePublishSchedule } from "@/hooks/use-publish-schedule";
import { usePublishStatus } from "@/hooks/use-publish-status";
import type { Draft } from "@shared/schema";

export default function DraftsPage() {
  const isSignedIn = useIsSignedIn();
  const { toast } = useToast();
  const [editingDraft, setEditingDraft] = useState<Draft | null>(null);
  const [editContent, setEditContent] = useState("");
  const [postingDraft, setPostingDraft] = useState<Draft | null>(null);
  const [schedulingDraft, setSchedulingDraft] = useState<Draft | null>(null);
  const [deletingDraft, setDeletingDraft] = useState<Draft | null>(null);
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const [bulkScheduleOpen, setBulkScheduleOpen] = useState(false);
  const [draftView, setDraftView] = useState<"ready" | "scheduled" | "attention" | "published">("ready");
  const [bulkDate, setBulkDate] = useState("");
  const [bulkTime, setBulkTime] = useState("09:00");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const { publishNow, isLoading: isPublishing } = usePublishSchedule();
  const { bulkSchedule, isLoading: isBulkScheduling } = usePublishSchedule();
  const { cancelSchedule } = usePublishSchedule();
  const [publishingJobId, setPublishingJobId] = useState<string | null>(null);
  const publishStatus = usePublishStatus(publishingJobId);

  const { data: drafts, isLoading } = useQuery<Draft[]>({
    queryKey: ["/api/drafts"],
    enabled: !!isSignedIn,
  });

  // Draft-level status (used for the tabs/cards) doesn't carry the scheduled
  // time or failure reason - those live on draft_schedules, so the schedule
  // endpoint is fetched once here and merged in, instead of rendering a whole
  // second, separate scheduled-drafts view below the main list.
  const { data: scheduleData } = useQuery<{ items: Array<{ draftId: string; scheduledPublishAt: string; lastError: string | null }> }>({
    queryKey: ["/api/drafts/scheduled-info"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/drafts/scheduled?limit=200");
      return res.json();
    },
    enabled: !!isSignedIn,
  });
  const scheduleInfoById = new Map<string, DraftScheduleInfo>(
    (scheduleData?.items ?? []).map((item) => [item.draftId, { scheduledPublishAt: item.scheduledPublishAt, lastError: item.lastError }]),
  );

  const updateDraftMutation = useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const res = await apiRequest("PATCH", `/api/drafts/${id}`, { content });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drafts"] });
      toast({
        title: "Draft updated",
        description: "Your changes have been saved.",
      });
      setEditingDraft(null);
    },
    onError: () => {
      toast({
        title: "Failed to update",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteDraftMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/drafts/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drafts"] });
      toast({
        title: "Draft deleted",
        description: "The draft has been removed.",
      });
      setDeletingDraft(null);
    },
    onError: () => {
      toast({
        title: "Failed to delete",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleEdit = (draft: Draft) => {
    setEditingDraft(draft);
    setEditContent(draft.content);
  };

  const handleSaveEdit = () => {
    if (editingDraft) {
      if (editContent.length > getPlatformMeta(editingDraft.platform).charLimit) {
        toast({ title: "Draft is too long", description: `Keep it under ${getPlatformMeta(editingDraft.platform).charLimit} characters for ${getPlatformMeta(editingDraft.platform).label}.`, variant: "destructive" });
        return;
      }
      updateDraftMutation.mutate({ id: editingDraft.id, content: editContent });
    }
  };

  const handleCancelSchedule = async (draft: Draft) => {
    const success = await cancelSchedule(draft.id);
    if (success) {
      queryClient.invalidateQueries({ queryKey: ["/api/drafts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drafts/scheduled-info"] });
    }
  };

  const handleRetry = async (draft: Draft) => {
    try {
      await apiRequest("POST", `/api/drafts/${draft.id}/retry-publish`);
      toast({ title: "Retry started", description: "The publication has been re-queued." });
      queryClient.invalidateQueries({ queryKey: ["/api/drafts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drafts/scheduled-info"] });
    } catch (error) {
      toast({ title: "Retry failed", description: error instanceof Error ? error.message : "Could not retry publication", variant: "destructive" });
    }
  };

  const handlePost = (draft: Draft) => {
    setPostingDraft(draft);
  };

  const handleCopyAndPost = (draft: Draft) => {
    navigator.clipboard.writeText(draft.content);
    const meta = getPlatformMeta(draft.platform);
    toast({
      title: "Content copied!",
      description: `Paste it into ${meta.label}.`,
    });
    
    window.open(meta.composeUrl(draft.content), "_blank");
    setPostingDraft(null);
  };

  const handlePublishNow = async (draft: Draft) => {
    const result = await publishNow(draft.id);
    if (!result) return;
    if (result.jobId) {
      // Queued (production/Redis) - keep the dialog open and wait for the
      // real outcome instead of assuming success and closing immediately.
      setPublishingJobId(result.jobId);
    } else {
      // Sync fallback already completed by the time this resolved.
      queryClient.invalidateQueries({ queryKey: ["/api/drafts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drafts/published"] });
      setPostingDraft(null);
    }
  };

  useEffect(() => {
    if (!publishingJobId || !publishStatus.status) return;
    const { state, progress, error } = publishStatus.status;
    if (state === "completed") {
      queryClient.invalidateQueries({ queryKey: ["/api/drafts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drafts/published"] });
      toast({ title: "Published", description: "Your post is live." });
      setPublishingJobId(null);
      publishStatus.reset();
      setPostingDraft(null);
    } else if (state === "failed") {
      queryClient.invalidateQueries({ queryKey: ["/api/drafts"] });
      toast({
        title: "Publish failed",
        description: progress?.error || error || "Could not publish this draft. Check its status for details.",
        variant: "destructive",
      });
      setPublishingJobId(null);
      publishStatus.reset();
      setPostingDraft(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishStatus.status, publishingJobId]);

  const draftsList = drafts || [];
  const filteredDrafts = draftsList.filter((draft) => {
    if (platformFilter !== "all" && draft.platform !== platformFilter) return false;
    if (searchQuery.trim() && !draft.content.toLowerCase().includes(searchQuery.trim().toLowerCase())) return false;
    return true;
  });
  const statusCounts = {
    ready: filteredDrafts.filter((draft) => draft.publishStatus === "draft").length,
    scheduled: filteredDrafts.filter((draft) => draft.publishStatus === "scheduled").length,
    attention: filteredDrafts.filter((draft) => draft.publishStatus === "failed").length,
    published: filteredDrafts.filter((draft) => draft.publishStatus === "published").length,
  };
  const visibleDrafts = filteredDrafts.filter((draft) => draftView === "ready" ? draft.publishStatus === "draft" : draftView === "scheduled" ? draft.publishStatus === "scheduled" : draftView === "attention" ? draft.publishStatus === "failed" : draft.publishStatus === "published");
  const visibleSchedulableIds = visibleDrafts.filter((draft) => draft.publishStatus !== "published").map((draft) => draft.id);
  const allVisibleSelected = visibleSchedulableIds.length > 0 && visibleSchedulableIds.every((id) => selectedDraftIds.has(id));
  const toggleDraft = (id: string) => setSelectedDraftIds((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleSelectAllVisible = () => setSelectedDraftIds((current) => {
    const next = new Set(current);
    if (allVisibleSelected) visibleSchedulableIds.forEach((id) => next.delete(id));
    else visibleSchedulableIds.forEach((id) => next.add(id));
    return next;
  });
  const submitBulkSchedule = async () => {
    if (!bulkDate || selectedDraftIds.size === 0) return;
    const [hours, minutes] = bulkTime.split(":");
    const date = new Date(`${bulkDate}T00:00:00Z`);
    const publishAt = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), Number(hours), Number(minutes), 0));
    const result = await bulkSchedule(Array.from(selectedDraftIds), publishAt);
    if (result) { setSelectedDraftIds(new Set()); setBulkDate(""); setBulkTime("09:00"); setBulkScheduleOpen(false); queryClient.invalidateQueries({ queryKey: ["/api/drafts"] }); queryClient.invalidateQueries({ queryKey: ["/api/drafts/scheduled"] }); }
  };

  const statusLabels: Record<"ready" | "scheduled" | "attention" | "published", string> = {
    ready: "Ready",
    scheduled: "Scheduled",
    attention: "Needs attention",
    published: "Published",
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        icon={FileText}
        title="Drafts"
        subtitle={`${draftsList.length} draft${draftsList.length !== 1 ? "s" : ""} saved`}
        stats={((["ready", "scheduled", "attention", "published"] as const).map((view) => (
          <Button
            key={view}
            size="sm"
            variant={draftView === view ? "secondary" : "outline"}
            onClick={() => setDraftView(view)}
            data-testid={`tab-${view}`}
          >
            {statusCounts[view]} {statusLabels[view]}
          </Button>
        )))}
        actions={selectedDraftIds.size > 0 && <Button onClick={() => setBulkScheduleOpen(true)}><CalendarPlus className="mr-2 h-4 w-4" />Schedule {selectedDraftIds.size} selected</Button>}
      />

      <main className="flex-1 p-6 overflow-y-auto">
        {isLoading ? (
          <div className="grid gap-4 max-w-3xl mx-auto">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-48 w-full rounded-lg" />
            ))}
          </div>
        ) : draftsList.length === 0 ? (
          <DashboardEmptyState
            icon={FileText}
            title="No drafts yet"
            description="Go to Discover, select an article, and generate a post. Saved drafts will appear here."
          />
        ) : (
          <>
          <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center gap-2">
            {visibleSchedulableIds.length > 0 && (
              <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectAllVisible} aria-label="Select all visible drafts" />
                Select all
              </label>
            )}
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search drafts…"
                className="pl-8"
                data-testid="input-search-drafts"
              />
            </div>
            <Select value={platformFilter} onValueChange={setPlatformFilter}>
              <SelectTrigger className="w-[170px]" data-testid="select-platform-filter">
                <SelectValue placeholder="All platforms" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All platforms</SelectItem>
                {PLATFORMS.map((platform) => (
                  <SelectItem key={platform.value} value={platform.value}>
                    {platform.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedDraftIds.size > 0 && (
              <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
                <span>{selectedDraftIds.size} selected</span>
                <Button variant="ghost" size="sm" onClick={() => setSelectedDraftIds(new Set())}>
                  Clear
                </Button>
              </div>
            )}
          </div>
          <div className="grid gap-4 max-w-3xl mx-auto">
            {visibleDrafts.map((draft) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                scheduleInfo={scheduleInfoById.get(draft.id)}
                selected={selectedDraftIds.has(draft.id)}
                onToggleSelect={() => toggleDraft(draft.id)}
                onPost={() => handlePost(draft)}
                onEdit={() => handleEdit(draft)}
                onSchedule={() => setSchedulingDraft(draft)}
                onCancelSchedule={() => handleCancelSchedule(draft)}
                onRetry={() => handleRetry(draft)}
                onDeleteRequest={() => setDeletingDraft(draft)}
              />
            ))}
          </div>
          {visibleDrafts.length === 0 && (
            <p className="mx-auto max-w-3xl py-10 text-center text-sm text-muted-foreground">
              No {draftView === "attention" ? "drafts needing attention" : `${draftView} drafts`}
              {searchQuery || platformFilter !== "all" ? " match your filters." : " right now."}
            </p>
          )}
          </>
        )}
      </main>

      <Dialog open={!!editingDraft} onOpenChange={(open) => !open && setEditingDraft(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Draft</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="min-h-[200px] resize-none"
              placeholder="Your post content..."
              data-testid="textarea-edit-content"
            />
            <div className="mt-2 space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{editContent.length} / {editingDraft ? getPlatformMeta(editingDraft.platform).charLimit : 0} characters</span>
                <span className={editingDraft && editContent.length > getPlatformMeta(editingDraft.platform).charLimit ? "text-destructive" : ""}>{editingDraft ? getPlatformMeta(editingDraft.platform).label : ""}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div className={`h-full transition-[width] ${editingDraft && editContent.length > getPlatformMeta(editingDraft.platform).charLimit ? "bg-destructive" : "bg-secondary"}`} style={{ width: `${Math.min((editContent.length / (editingDraft ? getPlatformMeta(editingDraft.platform).charLimit : 1)) * 100, 100)}%` }} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingDraft(null)} data-testid="button-cancel-edit">
              Cancel
            </Button>
            <Button 
              onClick={handleSaveEdit} 
              disabled={updateDraftMutation.isPending}
              data-testid="button-save-edit"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkScheduleOpen} onOpenChange={setBulkScheduleOpen}>
        <DialogContent><DialogHeader><DialogTitle>Schedule selected drafts</DialogTitle><DialogDescription>All {selectedDraftIds.size} selected drafts will publish at the same UTC time.</DialogDescription></DialogHeader><div className="grid gap-4 py-3 sm:grid-cols-2"><div><label htmlFor="bulk-schedule-date" className="mb-2 block text-sm font-medium">Date</label><Input id="bulk-schedule-date" type="date" min={new Date().toISOString().split("T")[0]} value={bulkDate} onChange={(event) => setBulkDate(event.target.value)} /></div><div><label htmlFor="bulk-schedule-time" className="mb-2 block text-sm font-medium">Time (UTC)</label><Input id="bulk-schedule-time" type="time" value={bulkTime} onChange={(event) => setBulkTime(event.target.value)} /></div></div><DialogFooter><Button variant="outline" onClick={() => setBulkScheduleOpen(false)}>Cancel</Button><Button disabled={!bulkDate || isBulkScheduling} onClick={submitBulkSchedule}>{isBulkScheduling ? "Scheduling…" : `Schedule ${selectedDraftIds.size} drafts`}</Button></DialogFooter></DialogContent>
      </Dialog>

      {schedulingDraft && <ScheduleArticleModal
        draftId={schedulingDraft.id}
        draftTitle={schedulingDraft.content.slice(0, 70)}
        open={!!schedulingDraft}
        onOpenChange={(open) => !open && setSchedulingDraft(null)}
        onScheduled={() => { queryClient.invalidateQueries({ queryKey: ["/api/drafts"] }); setSchedulingDraft(null); }}
      />}

      <Dialog open={!!postingDraft} onOpenChange={(open) => !open && setPostingDraft(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {postingDraft && (() => {
                const Icon = getPlatformMeta(postingDraft.platform).icon;
                return <Icon className="w-5 h-5" />;
              })()}
              Post to {postingDraft ? getPlatformMeta(postingDraft.platform).label : ""}
            </DialogTitle>
            <DialogDescription>
              Your content will be copied to the clipboard and {postingDraft ? getPlatformMeta(postingDraft.platform).label : "the platform"} will open in a new tab.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="bg-muted p-4 rounded-md text-sm whitespace-pre-wrap line-clamp-6">
              {postingDraft?.content}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPostingDraft(null)} data-testid="button-cancel-post">
              Cancel
            </Button>
            <Button 
              onClick={() => postingDraft && handlePublishNow(postingDraft)}
              disabled={isPublishing || !!publishingJobId}
              data-testid="button-publish-now"
            >
              <Send className="w-4 h-4 mr-1.5" />
              {isPublishing || publishingJobId ? "Publishing…" : "Publish now"}
            </Button>
            <Button variant="outline" onClick={() => postingDraft && handleCopyAndPost(postingDraft)} data-testid="button-copy-and-post">
              <ExternalLink className="w-4 h-4 mr-1.5" />
              Copy & Open
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingDraft} onOpenChange={(open) => !open && setDeletingDraft(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone. The draft and its content will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingDraft && deleteDraftMutation.mutate(deletingDraft.id)}
              disabled={deleteDraftMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteDraftMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
