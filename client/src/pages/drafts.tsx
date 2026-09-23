import { useState, useEffect, useRef } from "react";
import { useSearch, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileText, Search, Send, ExternalLink, CalendarPlus } from "lucide-react";
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
import { DraftCard, canEditDraft, type DraftScheduleInfo } from "@/components/dashboard/draft-card";
import { usePublishSchedule } from "@/hooks/use-publish-schedule";
import { useDraftPublishStatus } from "@/hooks/use-publish-status";
import { usePublishingReadiness } from "@/hooks/use-publishing-readiness";
import { ScheduleTargetActions } from "@/components/publishing-target-actions";
import { canChangeSchedule, draftStatusGroup, fetchPublishingSchedules, invalidatePublishingQueries, selectionBlockers } from "@/lib/publishing";
import { dateKeyInTimeZone, publishingDefaults, scheduleTimeValidation } from "@/lib/calendar";
import type { Draft } from "@shared/schema";

// Query cache is scoped/cleared with the authenticated app session. Keep only
// IDs, not content, across Content remounts; hiding a monitor is not resolution.
const attemptedDraftsKey = ["content-publish-attempts"];
queryClient.setQueryDefaults(attemptedDraftsKey, { gcTime: Infinity });

export default function DraftsPage() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const requestedView = new URLSearchParams(search).get("view");
  const isSignedIn = useIsSignedIn();
  const { toast } = useToast();
  const [editingDraft, setEditingDraft] = useState<Draft | null>(null);
  const [copyingDraft, setCopyingDraft] = useState<Draft | null>(null);
  const copyLock = useRef(false);
  const [editContent, setEditContent] = useState("");
  const [postingDraft, setPostingDraft] = useState<Draft | null>(null);
  const [schedulingDraft, setSchedulingDraft] = useState<Draft | null>(null);
  const [deletingDraft, setDeletingDraft] = useState<Draft | null>(null);
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const [bulkScheduleOpen, setBulkScheduleOpen] = useState(false);
  const [draftView, setDraftView] = useState<"ready" | "scheduled" | "attention" | "published">("ready");
  useEffect(() => {
    setDraftView(requestedView === "scheduled" || requestedView === "attention" || requestedView === "published" ? requestedView : "ready");
  }, [requestedView]);
  const [bulkDate, setBulkDate] = useState("");
  const [bulkTime, setBulkTime] = useState("09:00");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const publishLock = useRef(false);
  const [trackedDraftId, setTrackedDraftId] = useState<string | null>(null);
  const [attemptedDraftIds, setAttemptedDraftIds] = useState<Set<string>>(() => new Set(queryClient.getQueryData<string[]>(attemptedDraftsKey) ?? []));
  const [publishMessage, setPublishMessage] = useState("");
  const readiness = usePublishingReadiness(!!isSignedIn);
  const { timeZone, time: preferredTime } = publishingDefaults(readiness.profile);
  const { bulkSchedule, isLoading: isBulkScheduling } = usePublishSchedule();
  const { cancelSchedule } = usePublishSchedule();
  const publishStatus = useDraftPublishStatus(trackedDraftId);

  const { data: drafts, isLoading, isError: draftsError, refetch: refetchDrafts } = useQuery<Draft[]>({
    queryKey: ["/api/drafts"],
    enabled: !!isSignedIn,
    refetchInterval: 15_000,
  });

  // Draft-level status (used for the tabs/cards) doesn't carry the scheduled
  // time or failure reason - those live on draft_schedules, so the schedule
  // endpoint is fetched once here and merged in, instead of rendering a whole
  // second, separate scheduled-drafts view below the main list.
  const { data: scheduleData, isError: scheduleError } = useQuery({
    queryKey: ["/api/drafts/scheduled-info"],
    queryFn: ({ signal }) => fetchPublishingSchedules(signal),
    enabled: !!isSignedIn,
    refetchInterval: 15_000,
    staleTime: 0,
  });
  const scheduleInfoById = new Map<string, DraftScheduleInfo>(
    (scheduleData?.items ?? []).map((item) => [item.draftId, { scheduledPublishAt: item.scheduledPublishAt, lastError: item.lastError ?? null, schedule: item }]),
  );
  const scheduleFor = (draft: Draft) => scheduleData?.items.find((item) => item.draftId === draft.id && item.status !== "cancelled");
  const editable = (draft: Draft) => !draftsError && !!scheduleData && !scheduleError && !attemptedDraftIds.has(draft.id)
    && canEditDraft(draft, scheduleInfoById.get(draft.id)?.schedule);
  const blockersFor = (draft: Draft) => {
    const schedule = scheduleFor(draft);
    const platforms = schedule?.targets?.map((target) => target.platform) ?? [draft.platform];
    const warnings = selectionBlockers(platforms, draft, readiness);
    if (draftsError) warnings.push("Content could not be refreshed. Try again before publishing.");
    if (attemptedDraftIds.has(draft.id)) warnings.push("A publication was already requested for this draft. Check delivery status; do not send another copy.");
    if (!scheduleData || scheduleError) warnings.push("Schedule status is unavailable. Refresh before publishing.");
    if (schedule && !canChangeSchedule(schedule)) warnings.push("Use per-target recovery; do not send another copy.");
    if (!["draft", "scheduled"].includes(draft.publishStatus)) warnings.push("Check target status before publishing again.");
    return warnings;
  };

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
    onError: (error) => {
      toast({
        title: "Failed to update",
        description: `${error instanceof Error ? error.message : "Please try again."} Your text is retained.`,
        variant: "destructive",
      });
    },
  });

  const approveDraftMutation = useMutation({
    mutationFn: async (draft: Draft) => (await apiRequest("POST", `/api/drafts/${encodeURIComponent(draft.id)}/approve-publishing`, { content: draft.content, updatedAt: draft.updatedAt })).json(),
    onSuccess: () => { void invalidatePublishingQueries(); toast({ title: "Review recorded", description: "This exact draft is approved. Nothing was published." }); },
    onError: (error: Error) => toast({ title: "Approval not recorded", description: error.message, variant: "destructive" }),
  });

  const dirty = !!editingDraft && editContent !== editingDraft.content;
  const editGuard = useRef({ dirty, saving: updateDraftMutation.isPending });
  editGuard.current = { dirty, saving: updateDraftMutation.isPending };
  const confirmLeaveEdit = () => {
    if (editGuard.current.saving) return false;
    if (editGuard.current.dirty && !window.confirm("Discard unsaved draft changes?")) return false;
    editGuard.current.dirty = false;
    setEditingDraft(null);
    return true;
  };

  useEffect(() => {
    if (!editingDraft) return;
    const guardUnload = (event: BeforeUnloadEvent) => {
      if (!editGuard.current.dirty && !editGuard.current.saving) return;
      event.preventDefault(); event.returnValue = "";
    };
    // Wouter navigates through History. Guard before its patched methods notify
    // route subscribers, covering links and programmatic navigation alike.
    const push = window.history.pushState;
    const replace = window.history.replaceState;
    const currentUrl = window.location.href;
    const currentState = window.history.state;
    const guarded = (method: History["pushState"]): History["pushState"] => function (data, unused, url) {
      if (url != null && new URL(String(url), window.location.href).href !== window.location.href && !confirmLeaveEdit()) return;
      method.call(window.history, data, unused, url);
    };
    const guardedPush = guarded(push);
    const guardedReplace = guarded(replace);
    window.history.pushState = guardedPush;
    window.history.replaceState = guardedReplace;
    const guardPop = (event: PopStateEvent) => {
      if (window.location.href === currentUrl || confirmLeaveEdit()) return;
      event.stopImmediatePropagation();
      push.call(window.history, currentState, "", currentUrl);
    };
    // Cancel traversal before it changes history on browsers with Navigation
    // API support. The popstate fallback still retains edits on older browsers.
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const guardTraversal = (event: Event) => {
      if ((event as Event & { navigationType?: string }).navigationType === "traverse" && event.cancelable && !confirmLeaveEdit()) event.preventDefault();
    };
    navigation?.addEventListener("navigate", guardTraversal);
    window.addEventListener("beforeunload", guardUnload);
    window.addEventListener("popstate", guardPop, true);
    return () => {
      navigation?.removeEventListener("navigate", guardTraversal);
      window.removeEventListener("beforeunload", guardUnload);
      window.removeEventListener("popstate", guardPop, true);
      if (window.history.pushState === guardedPush) window.history.pushState = push;
      if (window.history.replaceState === guardedReplace) window.history.replaceState = replace;
    };
  }, [editingDraft]);

  const copyDraftMutation = useMutation({
    mutationFn: async (draft: Draft) => {
      // Explicit allowlist: no ID, delivery status, timestamps, schedule or logs.
      const response = await apiRequest("POST", "/api/drafts", {
        content: draft.content, platform: draft.platform, tone: draft.tone, media: draft.media ?? [],
      });
      return response.json() as Promise<Draft>;
    },
    onSuccess: (draft) => {
      queryClient.setQueryData<Draft[]>(["/api/drafts"], current => [draft, ...(current ?? [])]);
      void invalidatePublishingQueries();
      setCopyingDraft(null);
      navigate(`${location}?view=ready`);
      toast({ title: "New draft created", description: "The published original and its receipts are unchanged. Nothing was scheduled or published." });
    },
    onError: (error) => toast({ title: "Could not copy draft", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" }),
    onSettled: () => { copyLock.current = false; },
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
    if (!editable(draft)) return;
    setEditingDraft(draft);
    setEditContent(draft.content);
  };

  const handleSaveEdit = () => {
    if (editingDraft && !updateDraftMutation.isPending) {
      const latest = drafts?.find(draft => draft.id === editingDraft.id);
      if (!latest || !editable(latest)) {
        toast({ title: "Draft is read-only", description: "Delivery status has changed or is unavailable. Your unsaved text is retained.", variant: "destructive" });
        return;
      }
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
    if (attemptedDraftIds.has(draft.id)) {
      setTrackedDraftId(draft.id);
      setPublishMessage("Checking delivery status. Do not send another copy.");
    }
    else if (!trackedDraftId) setPublishMessage("");
    setPostingDraft(draft);
  };

  const handleCopyAndPost = async (draft: Draft) => {
    const meta = getPlatformMeta(draft.platform);
    try {
      await navigator.clipboard.writeText(draft.content);
      window.open(meta.composeUrl(draft.content), "_blank", "noopener,noreferrer");
      toast({ title: "Content copied", description: `Paste and publish manually in ${meta.label}. This does not confirm publication here. If no tab opens, open the platform yourself.` });
    } catch {
      toast({ title: "Could not copy", description: "Select and copy the text manually, then open the platform. Nothing was published.", variant: "destructive" });
    }
  };

  const handlePublishNow = async (draft: Draft) => {
    if (publishLock.current || trackedDraftId === draft.id || blockersFor(draft).length) return;
    publishLock.current = true;
    const attempted = new Set(attemptedDraftIds).add(draft.id);
    queryClient.setQueryData(attemptedDraftsKey, [...attempted]);
    setAttemptedDraftIds(attempted);
    setTrackedDraftId(null);
    setIsPublishing(true);
    setPublishMessage("Submitting direct publication request…");
    try {
      await apiRequest("POST", `/api/drafts/${encodeURIComponent(draft.id)}/publish-now`);
      setPublishMessage("Request processed. Checking every target; a completed or skipped job is not confirmation of delivery.");
    } catch (error) {
      setPublishMessage(`${error instanceof Error ? error.message : "Request interrupted"}. Delivery is not confirmed. Check target status before retrying.`);
    } finally {
      // Also reconcile errors: admission/enqueue may have partially succeeded.
      setTrackedDraftId(draft.id);
      setIsPublishing(false);
      publishLock.current = false;
      void invalidatePublishingQueries();
    }
  };

  useEffect(() => {
    if (!trackedDraftId || !publishStatus.schedule) return;
    if (publishStatus.outcome === "published") {
      setPublishMessage("All targets are recorded as published. Check the platform for the delivered post.");
      void invalidatePublishingQueries();
    } else if (publishStatus.outcome === "simulated") {
      setPublishMessage("Simulation completed. Nothing was posted externally and no live receipt exists.");
      void invalidatePublishingQueries();
    } else if (publishStatus.outcome === "attention") {
      setPublishMessage("Not all targets published. Review the individual outcomes below; retry only failed targets.");
      void invalidatePublishingQueries();
    } else if (publishStatus.outcome === "unknown") {
      setPublishMessage("Delivery is uncertain. Check the provider before retrying; delivery could have succeeded.");
      void invalidatePublishingQueries();
    }
  }, [publishStatus.schedule, publishStatus.outcome, trackedDraftId]);

  const draftsList = drafts || [];
  const filteredDrafts = draftsList.filter((draft) => {
    if (platformFilter !== "all" && draft.platform !== platformFilter && !scheduleFor(draft)?.targets?.some((target) => target.platform === platformFilter)) return false;
    if (searchQuery.trim() && !draft.content.toLowerCase().includes(searchQuery.trim().toLowerCase())) return false;
    return true;
  });
  const statusCounts = {
    ready: filteredDrafts.filter((draft) => draftStatusGroup(draft.publishStatus) === "ready").length,
    scheduled: filteredDrafts.filter((draft) => draftStatusGroup(draft.publishStatus) === "scheduled").length,
    attention: filteredDrafts.filter((draft) => draftStatusGroup(draft.publishStatus) === "attention").length,
    published: filteredDrafts.filter((draft) => draftStatusGroup(draft.publishStatus) === "published").length,
  };
  const visibleDrafts = filteredDrafts.filter((draft) => draftStatusGroup(draft.publishStatus) === draftView);
  const visibleSchedulableIds = visibleDrafts.filter((draft) => draft.publishStatus === "draft" && !blockersFor(draft).length).map((draft) => draft.id);
  const allVisibleSelected = visibleSchedulableIds.length > 0 && visibleSchedulableIds.every((id) => selectedDraftIds.has(id));
  const toggleDraft = (id: string) => setSelectedDraftIds((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleSelectAllVisible = () => setSelectedDraftIds((current) => {
    const next = new Set(current);
    if (allVisibleSelected) visibleSchedulableIds.forEach((id) => next.delete(id));
    else visibleSchedulableIds.forEach((id) => next.add(id));
    return next;
  });
  const submitBulkSchedule = async () => {
    const validation = scheduleTimeValidation(bulkDate, bulkTime, timeZone);
    if (bulkWarnings.length || !validation.publishAt || isBulkScheduling) return;
    const result = await bulkSchedule(Array.from(selectedDraftIds), validation.publishAt);
    await invalidatePublishingQueries();
    if (result) {
      setSelectedDraftIds(new Set(result.failed));
      if (!result.failed.length) setBulkScheduleOpen(false);
    }
  };
  const bulkValidation = scheduleTimeValidation(bulkDate, bulkTime, timeZone);
  const bulkWarnings = [...(bulkValidation.error ? [bulkValidation.error] : [])];
  if (selectedDraftIds.size < 1 || selectedDraftIds.size > 50) bulkWarnings.push("Select between 1 and 50 drafts.");
  for (const id of selectedDraftIds) {
    const draft = draftsList.find((item) => item.id === id);
    if (!draft || draft.publishStatus !== "draft" || blockersFor(draft).length) bulkWarnings.push(`Draft ${id} is no longer ready. Clear it from the selection and review its status.`);
  }
  const postingWarnings = postingDraft ? blockersFor(draftsList.find((draft) => draft.id === postingDraft.id) ?? postingDraft) : [];
  const currentPostingDraft = draftsList.find(draft => draft.id === postingDraft?.id) ?? postingDraft;
  const manualUnsafe = !!currentPostingDraft && (draftsError || !scheduleData || scheduleError || attemptedDraftIds.has(currentPostingDraft.id) || currentPostingDraft.publishStatus !== "draft" || !!scheduleFor(currentPostingDraft));

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
        title="Content"
        subtitle={draftsError ? "Content is unavailable" : `${draftsList.length} draft${draftsList.length !== 1 ? "s" : ""} saved`}
          actions={<>
            <div className="flex flex-wrap items-center gap-2">{((["ready", "scheduled", "attention", "published"] as const).map((view) => (
              <Button
                key={view}
                size="sm"
                variant={draftView === view ? "secondary" : "outline"}
                onClick={() => {
                  if (editingDraft && !confirmLeaveEdit()) return;
                  setDraftView(view);
                  navigate(`${location}?view=${view}`);
                }}
                aria-pressed={draftView === view}
                data-testid={`tab-${view}`}
              >
                {statusCounts[view]} {statusLabels[view]}
              </Button>
            )))}</div>
            {selectedDraftIds.size > 0 && <Button onClick={() => { setBulkTime(preferredTime); setBulkDate(dateKeyInTimeZone(new Date(), timeZone)); setBulkScheduleOpen(true); }}><CalendarPlus className="mr-2 h-4 w-4" />Schedule {selectedDraftIds.size} selected</Button>}
          </>}
      />

      <main className="flex-1 p-4 sm:p-6 overflow-y-auto">
        {scheduleError && <p role="alert" className="mx-auto mb-4 max-w-3xl text-sm text-destructive">Schedule details could not be loaded. Direct publishing is disabled until status can be verified.</p>}
        {trackedDraftId && !postingDraft && <div className="mx-auto mb-4 max-w-3xl rounded-md border p-3 text-sm"><p>{publishStatus.error || publishMessage}</p><Button variant="outline" size="sm" onClick={() => setPostingDraft(draftsList.find((draft) => draft.id === trackedDraftId) ?? null)}>View publishing status</Button><Button variant="ghost" size="sm" disabled={isPublishing} onClick={() => setTrackedDraftId(null)}>Dismiss monitor</Button></div>}
        {isLoading ? (
          <div className="grid gap-4 max-w-3xl mx-auto">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-48 w-full rounded-lg" />
            ))}
          </div>
        ) : draftsError ? (
          <div role="alert" className="mx-auto max-w-3xl rounded-md border p-4">
            <p>Content could not be loaded. Your drafts have not been removed.</p>
            <Button variant="outline" className="mt-3" onClick={() => void refetchDrafts()}>Try again</Button>
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
                aria-label="Search drafts"
                className="pl-8"
                data-testid="input-search-drafts"
              />
            </div>
            <Select value={platformFilter} onValueChange={setPlatformFilter}>
              <SelectTrigger className="w-[170px]" aria-label="Filter by platform" data-testid="select-platform-filter">
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
                timeZone={timeZone}
                canSchedule={!blockersFor(draft).length}
                scheduleBlocker={blockersFor(draft)[0]}
                selected={selectedDraftIds.has(draft.id)}
                onToggleSelect={() => toggleDraft(draft.id)}
                onPost={() => handlePost(draft)}
                onEdit={() => handleEdit(draft)}
                canEdit={editable(draft)}
                onCopyToDraft={() => setCopyingDraft(draft)}
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

      <Dialog open={!!editingDraft} onOpenChange={(open) => !open && confirmLeaveEdit()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Draft</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              value={editContent}
              disabled={updateDraftMutation.isPending}
              onChange={(e) => setEditContent(e.target.value)}
              className="min-h-[200px] resize-none"
              placeholder="Your post content..."
              aria-label="Draft content"
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
            <Button variant="outline" disabled={updateDraftMutation.isPending} onClick={confirmLeaveEdit} data-testid="button-cancel-edit">
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
        <DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>Schedule selected drafts</DialogTitle><DialogDescription>Request direct delivery for {selectedDraftIds.size} drafts at the same time in {timeZone}. Each draft retains its target platforms.</DialogDescription></DialogHeader><div className="grid gap-4 py-3 sm:grid-cols-2"><div><label htmlFor="bulk-schedule-date" className="mb-2 block text-sm font-medium">Date</label><Input id="bulk-schedule-date" type="date" min={dateKeyInTimeZone(new Date(), timeZone)} value={bulkDate} onChange={(event) => setBulkDate(event.target.value)} /></div><div><label htmlFor="bulk-schedule-time" className="mb-2 block text-sm font-medium">Time ({timeZone})</label><Input id="bulk-schedule-time" type="time" value={bulkTime} onChange={(event) => setBulkTime(event.target.value)} /></div></div>{bulkWarnings.length > 0 && <ul role="alert" className="list-disc pl-4 text-sm text-destructive">{bulkWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}<DialogFooter><Button variant="outline" onClick={() => setBulkScheduleOpen(false)}>Cancel</Button><Button disabled={bulkWarnings.length > 0 || isBulkScheduling} onClick={submitBulkSchedule}>{isBulkScheduling ? "Scheduling…" : `Schedule ${selectedDraftIds.size} drafts`}</Button></DialogFooter></DialogContent>
      </Dialog>

      {schedulingDraft && <ScheduleArticleModal
        draftId={schedulingDraft.id}
        draftTitle={schedulingDraft.content.slice(0, 70)}
        open={!!schedulingDraft}
        onOpenChange={(open) => !open && setSchedulingDraft(null)}
        onScheduled={() => { queryClient.invalidateQueries({ queryKey: ["/api/drafts"] }); setSchedulingDraft(null); }}
      />}

      <Dialog open={!!postingDraft} onOpenChange={(open) => !open && setPostingDraft(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {postingDraft && (() => {
                const Icon = getPlatformMeta(postingDraft.platform).icon;
                return <Icon className="w-5 h-5" />;
              })()}
              Publishing options
            </DialogTitle>
            <DialogDescription>
              Publish directly sends to connected target accounts. Copy & Open only copies text and opens {postingDraft ? getPlatformMeta(postingDraft.platform).label : "the platform"}; you must publish there yourself. It does not mark this draft as published.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="bg-muted p-4 rounded-md text-sm whitespace-pre-wrap">
              {currentPostingDraft?.content}
            </div>
            {!!currentPostingDraft?.media?.length && <ul className="text-sm">{currentPostingDraft.media.map(item => <li key={item.id}>{item.type}: {item.name}</li>)}</ul>}
            {currentPostingDraft && readiness.profile?.requirePublishReview && !currentPostingDraft.publishApprovedAt && ["draft", "scheduled", "failed"].includes(currentPostingDraft.publishStatus) && <Button className="mt-3" variant="outline" disabled={approveDraftMutation.isPending || draftsError} onClick={() => approveDraftMutation.mutate(currentPostingDraft)}>I reviewed this exact draft — approve publishing</Button>}
          </div>
          {postingWarnings.length > 0 && <ul className="list-disc pl-4 text-sm text-muted-foreground">{postingWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          {trackedDraftId === postingDraft?.id && <div role="status" className="space-y-2 text-sm"><p>{publishStatus.error || publishMessage || "Delivery is unconfirmed. Check status before retrying."}</p>{publishStatus.schedule && <ScheduleTargetActions item={publishStatus.schedule} />}<Button variant="outline" size="sm" disabled={publishStatus.checking || isPublishing} onClick={publishStatus.recheck}>Check delivery status</Button><Button variant="ghost" size="sm" disabled={isPublishing} onClick={() => { setTrackedDraftId(null); setPostingDraft(null); }}>Dismiss monitor</Button><p>Dismissing does not resolve uncertainty or permit another publication of this draft.</p></div>}
          {trackedDraftId !== postingDraft?.id && postingDraft && scheduleFor(postingDraft) && <ScheduleTargetActions item={scheduleFor(postingDraft)!} />}
          <DialogFooter className="gap-2 sm:flex-wrap">
            <Button variant="outline" onClick={() => setPostingDraft(null)} data-testid="button-cancel-post">
              Close
            </Button>
            <Button 
              onClick={() => postingDraft && handlePublishNow(postingDraft)}
              disabled={isPublishing || trackedDraftId === postingDraft?.id || postingWarnings.length > 0}
              data-testid="button-publish-now"
            >
              <Send className="w-4 h-4 mr-1.5" />
              {isPublishing ? "Submitting…" : "Publish directly now"}
            </Button>
            <Button variant="outline" disabled={isPublishing || trackedDraftId === postingDraft?.id || manualUnsafe} onClick={() => postingDraft && handleCopyAndPost(postingDraft)} data-testid="button-copy-and-post">
              <ExternalLink className="w-4 h-4 mr-1.5" />
              Copy & Open
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!copyingDraft} onOpenChange={(open) => !open && !copyDraftMutation.isPending && setCopyingDraft(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Copy this published record to a new draft?</AlertDialogTitle><AlertDialogDescription>The original and its publishing receipts stay unchanged. Only text, platform, tone and attached media are copied. The new draft is unscheduled and nothing is published.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={copyDraftMutation.isPending}>Cancel</AlertDialogCancel>
            <Button disabled={copyDraftMutation.isPending} onClick={() => {
              if (!copyingDraft || copyLock.current) return;
              copyLock.current = true;
              copyDraftMutation.mutate(copyingDraft);
            }}>{copyDraftMutation.isPending ? "Creating…" : "Create new draft"}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
