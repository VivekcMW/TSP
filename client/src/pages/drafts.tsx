import { useState, useEffect, useRef } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileText, Send, CalendarPlus, CalendarDays, ChevronLeft, Plus, Search } from "lucide-react";
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
import { NativeSelect } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { useToast } from "@/hooks/use-toast";
import { useIsSignedIn } from "@/lib/dev-auth";
import { accountCache, ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import { acknowledgeDraftSave, adoptDraftRevision, draftSaveBlocked, editDraftText, observeDraftRevision, parseDraftEditingSnapshot, type DraftEditingState } from "@shared/draft-revision";
import { DraftRevisionNotice } from "@/components/dashboard/social-preview-card";
import { getPlatformMeta, PLATFORMS } from "@/lib/platforms";
import { PageBody, PageHeader, PageToolbar } from "@/components/dashboard/page-header";
import { WorkflowStatus } from "@/components/dashboard/workflow-status";
import { PlatformComposeAction } from "@/components/platform-compose-action";
import { DashboardEmptyState } from "@/components/dashboard/empty-state";
import { ScheduleArticleModal } from "@/components/schedule-article-modal";
import { DraftCard, DraftListItem, canEditDraft, type DraftScheduleInfo } from "@/components/dashboard/draft-card";
import { usePublishSchedule } from "@/hooks/use-publish-schedule";
import { useDraftPublishStatus } from "@/hooks/use-publish-status";
import { usePublishingReadiness } from "@/hooks/use-publishing-readiness";
import { ScheduleTargetActions } from "@/components/publishing-target-actions";
import { canChangeSchedule, draftStatusGroup, fetchDraftDetails, fetchPublishingSchedules, invalidatePublishingQueries, publishingTextValidation, scheduleConfirmationKey, selectionBlockers } from "@/lib/publishing";
import { capturePublishingConsent, type PublishingConsent } from "@shared/publishing-consent";
import { dateKeyInTimeZone, publishingDefaults, scheduleTimeValidation } from "@/lib/calendar";
import { distinctDaySendSlots } from "@/lib/send-time";
import type { Draft } from "@shared/schema";
import { MAX_DRAFT_CHARACTERS, platformTextValidation } from "@shared/editorial";

// Query cache is scoped/cleared with the authenticated app session. Keep only
// IDs, not content, across Content remounts; hiding a monitor is not resolution.
const attemptedDraftsKey = ["content-publish-attempts"];
queryClient.setQueryDefaults(attemptedDraftsKey, { gcTime: Infinity });
type ContentView = "all" | ReturnType<typeof draftStatusGroup>;

export default function DraftsPage() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const requestedView = new URLSearchParams(search).get("view");
  const requestedDraftId = new URLSearchParams(search).get("draft");
  const appliedDraftLink = useRef<string | null>(null);
  const focusedDraftLink = useRef<string | null>(null);
  const linkedDraftElement = useRef<HTMLDivElement | null>(null);
  const previewPanel = useRef<HTMLElement>(null);
  const postList = useRef<HTMLDivElement>(null);
  const [previewDraftId, setPreviewDraftId] = useState<string | null>(null);
  const [mobilePreview, setMobilePreview] = useState(false);
  const [sortOrder, setSortOrder] = useState("updated");
  const isSignedIn = useIsSignedIn();
  const { toast } = useToast();
  const [editingDraft, setEditingDraft] = useState<Draft | null>(null);
  const [copyingDraft, setCopyingDraft] = useState<Draft | null>(null);
  const copyLock = useRef(false);
  const [editRevision, setEditRevisionState] = useState<DraftEditingState>({ content: "", status: "unsaved" });
  const editRevisionRef = useRef(editRevision);
  const editSession = useRef<AbortController | null>(null);
  const editRead = useRef<AbortController | null>(null);
  const editSaveLock = useRef(false);
  const editGuard = useRef({ dirty: false, saving: false });
  const editContent = editRevision.content;
  const editSaving = editRevision.status === "saving";
  const setEditRevision = (next: DraftEditingState) => {
    editRevisionRef.current = next;
    editGuard.current = { dirty: next.content !== next.savedContent || ["conflict", "refresh-failed", "failed"].includes(next.status), saving: editSaveLock.current };
    setEditRevisionState(next);
  };
  useEffect(() => () => { editSession.current?.abort(); editRead.current?.abort(); }, []);
  const [postingDraft, setPostingDraft] = useState<Draft | null>(null);
  const [schedulingDraft, setSchedulingDraft] = useState<Draft | null>(null);
  const [deletingDraft, setDeletingDraft] = useState<Draft | null>(null);
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const [bulkScheduleOpen, setBulkScheduleOpen] = useState(false);
  const [bulkConfirmedKey, setBulkConfirmedKey] = useState<string | null>(null);
  const [spreadAcrossWeek, setSpreadAcrossWeek] = useState(false);
  const [bulkErrors, setBulkErrors] = useState<Record<string, { code: string; message: string }>>({});
  const bulkLock = useRef(false);
  const [draftView, setDraftView] = useState<ContentView>("ready");
  useEffect(() => {
    setDraftView(requestedView === "all" || requestedView === "scheduled" || requestedView === "attention" || requestedView === "published" ? requestedView : "ready");
    setMobilePreview(false);
  }, [requestedView]);
  const [bulkDate, setBulkDate] = useState("");
  const [bulkTime, setBulkTime] = useState("09:00");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const publishLock = useRef(false);
  const manualPendingRef = useRef(false);
  const manualReadEpoch = useRef(0);
  useEffect(() => queryClient.getQueryCache().subscribe(event => {
    if (event.type !== "updated" || event.action.type !== "fetch") return;
    const key = String(event.query.queryKey[0]);
    if (key === "/api/drafts" || key.startsWith("/api/drafts/scheduled") || key.endsWith("/details")) manualReadEpoch.current++;
  }), []);
  const [manualPending, setManualPending] = useState(false);
  const [reconfirmDraftId, setReconfirmDraftId] = useState<string | null>(null);
  const [trackedDraftId, setTrackedDraftId] = useState<string | null>(null);
  const [attemptedDraftIds, setAttemptedDraftIds] = useState<Set<string>>(() => new Set(queryClient.getQueryData<string[]>(attemptedDraftsKey) ?? []));
  const attemptedDraftIdsRef = useRef(attemptedDraftIds);
  const [publishMessage, setPublishMessage] = useState("");
  const readiness = usePublishingReadiness(!!isSignedIn);
  const editScope = JSON.stringify([isSignedIn, readiness.profile?.tenantId]);
  const editScopeRef = useRef({ key: editScope });
  if (editScopeRef.current.key !== editScope) editScopeRef.current = { key: editScope };
  const renderEditScope = editScopeRef.current;
  const { timeZone, time: preferredTime } = publishingDefaults(readiness.profile);
  const { bulkSchedule, isLoading: isBulkScheduling } = usePublishSchedule();
  const { cancelSchedule } = usePublishSchedule();
  const publishStatus = useDraftPublishStatus(trackedDraftId);

  const { data: drafts, isLoading, isError: draftsError, isFetching: draftsFetching, refetch: refetchDrafts } = useQuery<Draft[]>({
    queryKey: ["/api/drafts"],
    enabled: !!isSignedIn,
    refetchInterval: 15_000,
  });
  const linkedQuery = useQuery<Draft>({
    queryKey: [`/api/drafts/${encodeURIComponent(requestedDraftId ?? "")}/details`],
    queryFn: ({ signal }) => fetchDraftDetails(requestedDraftId!, signal),
    enabled: !!isSignedIn && requestedDraftId !== null, retry: false, staleTime: 0, refetchInterval: 15_000,
  });
  const linkedDraft = !linkedQuery.isError ? linkedQuery.data : undefined;
  const draftsList = requestedDraftId === null ? drafts ?? []
    : [...(drafts ?? []).filter(draft => draft.id !== requestedDraftId), ...(linkedDraft ? [linkedDraft] : [])];

  // A handoff selects the exact saved record, never an editor baseline, bulk
  // checkbox or delivery action. A missing ID must not select a different draft.
  useEffect(() => {
    appliedDraftLink.current = null; focusedDraftLink.current = null;
  }, [requestedDraftId]);
  useEffect(() => {
    if (requestedDraftId === null) { appliedDraftLink.current = null; focusedDraftLink.current = null; return; }
    if (!linkedQuery.isSuccess || linkedQuery.isFetching || appliedDraftLink.current === requestedDraftId) return;
    const linked = linkedDraft;
    if (!linked) return;
    appliedDraftLink.current = requestedDraftId;
    setSearchQuery(""); setPlatformFilter("all");
    setPreviewDraftId(linked.id);
    setDraftView(draftStatusGroup(linked.publishStatus));
  }, [requestedDraftId, linkedDraft, linkedQuery.isSuccess, linkedQuery.isFetching]);

  // Draft-level status (used for the tabs/cards) doesn't carry the scheduled
  // time or failure reason - those live on draft_schedules, so the schedule
  // endpoint is fetched once here and merged in, instead of rendering a whole
  // second, separate scheduled-drafts view below the main list.
  const { data: scheduleData, isError: scheduleError, isFetching: schedulesFetching } = useQuery({
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
  const consentFor = (draft: Draft) => scheduleData ? capturePublishingConsent(draft, scheduleData.items.find(item => item.draftId === draft.id) ?? null) : undefined;
  const editable = (draft: Draft) => !draftsError && !!scheduleData && !scheduleError && !attemptedDraftIds.has(draft.id)
    && canEditDraft(draft, scheduleInfoById.get(draft.id)?.schedule);
  const blockersFor = (draft: Draft) => {
    const schedule = scheduleFor(draft);
    const platforms = schedule?.targets?.map((target) => target.platform) ?? [draft.platform];
    const warnings = selectionBlockers(platforms, draft, readiness);
    if (draftsError) warnings.push("Content could not be refreshed. Try again before publishing.");
    if (attemptedDraftIds.has(draft.id)) warnings.push("A publication was already requested for this draft. Check delivery status; do not send another copy.");
    if (!scheduleData || scheduleError) warnings.push("Schedule status is unavailable. Refresh before publishing.");
    if (!consentFor(draft)) warnings.push("The exact publishing revision is unavailable. Refresh and review before confirming.");
    if (schedule && !canChangeSchedule(schedule)) warnings.push("Use per-target recovery; do not send another copy.");
    if (!["draft", "scheduled"].includes(draft.publishStatus)) warnings.push("Check target status before publishing again.");
    return warnings;
  };
  const canResolveScheduling = (draft: Draft) => {
    if (draftsError || !scheduleData || scheduleError || attemptedDraftIds.has(draft.id)) return false;
    const schedule = scheduleFor(draft);
    return schedule ? draft.publishStatus === "scheduled" && canChangeSchedule(schedule) : draft.publishStatus === "draft";
  };

  const approveDraftMutation = useMutation({
    mutationFn: async (draft: Draft) => (await apiRequest("POST", `/api/drafts/${encodeURIComponent(draft.id)}/approve-publishing`, { content: draft.content, updatedAt: draft.updatedAt })).json(),
    onSuccess: () => { void invalidatePublishingQueries(); toast({ title: "Review recorded", description: "This exact draft is approved. Nothing was published." }); },
    onError: (error: Error) => toast({ title: "Approval not recorded", description: error.message, variant: "destructive" }),
  });

  const confirmLeaveEdit = () => {
    if (editSaveLock.current || editGuard.current.saving) return false;
    if (editGuard.current.dirty && !window.confirm("Discard unsaved draft changes?")) return false;
    editGuard.current.dirty = false;
    editSession.current?.abort(); editSession.current = null;
    editRead.current?.abort(); editRead.current = null;
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
      setPreviewDraftId(draft.id);
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
      void invalidatePublishingQueries();
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
    if (editSaveLock.current || !editable(draft)) return;
    editSession.current?.abort(); editSession.current = new AbortController();
    editRead.current?.abort(); editRead.current = null;
    setEditingDraft(draft);
    try {
      const snapshot = parseDraftEditingSnapshot({ ...draft, updatedAt: draft.updatedAt instanceof Date ? draft.updatedAt.toISOString() : draft.updatedAt }, draft);
      setEditRevision(acknowledgeDraftSave({ content: draft.content, status: "unsaved" }, draft.content, snapshot));
    } catch {
      setEditRevision({ content: draft.content, savedId: draft.id, status: "refresh-failed", error: "The editing baseline is unavailable. Check latest before saving." });
    }
  };

  const refreshEdit = async () => {
    const session = editSession.current, draft = editingDraft;
    if (!session || session.signal.aborted || editSaveLock.current || !draft || editRevisionRef.current.savedId !== draft.id ||
      editRevisionRef.current.status === "immutable" || editScopeRef.current !== renderEditScope) return;
    editRead.current?.abort();
    const read = new AbortController(); editRead.current = read;
    const signal = AbortSignal.any([session.signal, read.signal, accountCache.getSignal()]);
    const owns = () => !signal.aborted && editSession.current === session && editRead.current === read && editScopeRef.current === renderEditScope;
    setEditRevision({ ...editRevisionRef.current, status: "checking", error: undefined });
    try {
      const response = await apiRequest("GET", `/api/drafts/${encodeURIComponent(draft.id)}/editing-snapshot`, undefined, { signal, cache: "no-store" });
      const latest = parseDraftEditingSnapshot(await response.json(), draft);
      if (owns()) setEditRevision(observeDraftRevision(editRevisionRef.current, latest));
    } catch (error) {
      if (owns()) setEditRevision({ ...editRevisionRef.current, status: "refresh-failed", error: error instanceof ApiError && error.status === 404
        ? "The draft is missing or inaccessible. Local text is retained; nothing was recreated." : "Local text is retained. Cached data is not confirmation." });
    } finally { if (editRead.current === read) editRead.current = null; }
  };
  const resolveEdit = (choice: "load" | "keep" | "adopt") => {
    const current = editRevisionRef.current;
    if (editSaveLock.current || current.status !== "conflict" || !editSession.current || editScopeRef.current !== renderEditScope || current.latestRevision !== editRevision.latestRevision) return;
    if (choice === "keep") { setEditRevision({ ...current, keptLocal: true }); return; }
    if (!current.latestRevision) return;
    if (choice === "load" && current.content !== current.savedContent && current.content !== current.latestRevision.content &&
      !window.confirm("Load latest and discard your local edits? This cannot be undone. Nothing will be saved.")) return;
    setEditRevision(adoptDraftRevision(current, choice === "load"));
  };
  const handleSaveEdit = async () => {
    const current = editRevisionRef.current, session = editSession.current;
    if (editingDraft && current.savedId === editingDraft.id && session && !session.signal.aborted && !editSaveLock.current && !draftSaveBlocked(current) && editScopeRef.current === renderEditScope) {
      const latest = draftsList.find(draft => draft.id === editingDraft.id);
      if (!editable(latest ?? editingDraft)) {
        toast({ title: "Draft is read-only", description: "Delivery status has changed or is unavailable. Your unsaved text is retained.", variant: "destructive" });
        return;
      }
      const validation = platformTextValidation(current.content, editingDraft.platform, getPlatformMeta(editingDraft.platform).charLimit);
      if (validation.error) {
        toast({ title: "Check draft length", description: validation.error, variant: "destructive" });
        return;
      }
      editSaveLock.current = true;
      editRead.current?.abort(); editRead.current = null;
      const signal = AbortSignal.any([session.signal, accountCache.getSignal()]);
      const owns = () => !signal.aborted && editSession.current === session && editScopeRef.current === renderEditScope;
      setEditRevision({ ...current, status: "saving", error: undefined });
      try {
        const response = await apiRequest("PATCH", `/api/drafts/${encodeURIComponent(editingDraft.id)}`, {
          content: current.content, expectedContent: current.savedContent, expectedUpdatedAt: current.savedUpdatedAt,
        }, { signal });
        const saved = parseDraftEditingSnapshot(await response.json(), editingDraft);
        if (!owns()) return;
        const acknowledged = acknowledgeDraftSave(editRevisionRef.current, current.content, saved);
        setEditRevision(acknowledged);
        void invalidatePublishingQueries();
        if (acknowledged.status === "saved") {
          editGuard.current.dirty = false;
          editSession.current = null;
          setEditingDraft(null);
          toast({ title: "Draft updated", description: "Your changes have been saved." });
        }
      } catch (error) {
        if (!owns()) return;
        let status: DraftEditingState["status"] = "failed";
        if (error instanceof ApiError && error.status === 409) {
          if (error.code === "draft_conflict") status = "conflict";
          else if (error.code === "draft_immutable") status = "immutable";
        }
        setEditRevision({ ...editRevisionRef.current, latestRevision: undefined,
          status,
          error: `${error instanceof Error ? error.message : "Save could not be confirmed."} Your text is retained.` });
        toast({ title: "Failed to update", description: editRevisionRef.current.error, variant: "destructive" });
      } finally { editSaveLock.current = false; editGuard.current.saving = false; }
    }
  };

  const handleCancelSchedule = async (draft: Draft) => {
    const success = await cancelSchedule(draft.id);
    if (success) {
      void invalidatePublishingQueries();
    }
  };

  const handleRetry = async (draft: Draft) => {
    try {
      await apiRequest("POST", `/api/drafts/${draft.id}/retry-publish`);
      toast({ title: "Retry started", description: "The publication has been re-queued." });
      void invalidatePublishingQueries();
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

  const handlePublishNow = async (draft: Draft) => {
    const consent = consentFor(draft);
    if (publishLock.current || manualPendingRef.current || reconfirmDraftId === draft.id || !consent || trackedDraftId === draft.id || blockersFor(draft).length) return;
    publishLock.current = true;
    const attempted = new Set(attemptedDraftIds).add(draft.id);
    attemptedDraftIdsRef.current = attempted;
    queryClient.setQueryData(attemptedDraftsKey, [...attempted]);
    setAttemptedDraftIds(attempted);
    setTrackedDraftId(null);
    setIsPublishing(true);
    setPublishMessage("Submitting direct publication request…");
    try {
      await apiRequest("POST", `/api/drafts/${encodeURIComponent(draft.id)}/publish-now`, { consent });
      setPublishMessage("Request processed. Checking every target; a completed or skipped job is not confirmation of delivery.");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.code === "publishing_reconfirm_required") {
        setReconfirmDraftId(draft.id);
        setPublishMessage(error.message);
      } else setPublishMessage(`${error instanceof Error ? error.message : "Request interrupted"}. Delivery is not confirmed. Check target status before retrying.`);
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

  const clearDraftLink = () => {
    const params = new URLSearchParams(search);
    params.delete("draft");
    const suffix = params.size ? `?${params}` : "";
    navigate(`${location}${suffix}`, { replace: true });
  };
  const filteredDrafts = draftsList.filter((draft) => {
    if (platformFilter !== "all" && draft.platform !== platformFilter && !scheduleFor(draft)?.targets?.some((target) => target.platform === platformFilter)) return false;
    if (searchQuery.trim() && !draft.content.toLowerCase().includes(searchQuery.trim().toLowerCase())) return false;
    return true;
  });
  const statusCounts = {
    all: filteredDrafts.length,
    ready: filteredDrafts.filter((draft) => draftStatusGroup(draft.publishStatus) === "ready").length,
    scheduled: filteredDrafts.filter((draft) => draftStatusGroup(draft.publishStatus) === "scheduled").length,
    attention: filteredDrafts.filter((draft) => draftStatusGroup(draft.publishStatus) === "attention").length,
    published: filteredDrafts.filter((draft) => draftStatusGroup(draft.publishStatus) === "published").length,
  };
  const visibleDrafts = filteredDrafts.filter((draft) => draftView === "all" || draftStatusGroup(draft.publishStatus) === draftView).sort((a, b) => {
    const timestamp = (draft: Draft) => new Date((sortOrder === "updated" ? draft.updatedAt ?? draft.createdAt : draft.createdAt ?? draft.updatedAt) ?? 0).getTime();
    return sortOrder === "oldest" ? timestamp(a) - timestamp(b) : timestamp(b) - timestamp(a);
  });
  const previewDraft = requestedDraftId !== null
    ? visibleDrafts.find(draft => draft.id === requestedDraftId)
    : visibleDrafts.find(draft => draft.id === previewDraftId) ?? visibleDrafts[0];
  const firstVisibleId = visibleDrafts[0]?.id;
  useEffect(() => {
    if (requestedDraftId === null && previewDraftId === null && firstVisibleId) setPreviewDraftId(firstVisibleId);
  }, [requestedDraftId, previewDraftId, firstVisibleId]);
  const openPreview = (draft: Draft) => {
    setPreviewDraftId(draft.id);
    if (requestedDraftId !== null) clearDraftLink();
    if (window.matchMedia("(max-width: 1279px)").matches) {
      setMobilePreview(true);
      requestAnimationFrame(() => { previewPanel.current?.scrollIntoView({ block: "start" }); previewPanel.current?.focus({ preventScroll: true }); });
    }
  };
  const backToPosts = () => {
    setMobilePreview(false);
    requestAnimationFrame(() => postList.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus());
  };
  const linkedDraftVisible = visibleDrafts.some(draft => draft.id === requestedDraftId);
  useEffect(() => {
    if (requestedDraftId === null || !linkedDraftVisible || focusedDraftLink.current === requestedDraftId || !linkedDraftElement.current) return;
    focusedDraftLink.current = requestedDraftId;
    setMobilePreview(true);
    requestAnimationFrame(() => { linkedDraftElement.current?.scrollIntoView({ block: "nearest" }); linkedDraftElement.current?.focus({ preventScroll: true }); });
  }, [requestedDraftId, linkedDraftVisible]);
  const visibleSchedulableIds = visibleDrafts.filter((draft) => draft.publishStatus === "draft" && !blockersFor(draft).length).map((draft) => draft.id);
  const allVisibleSelected = visibleSchedulableIds.length > 0 && visibleSchedulableIds.every((id) => selectedDraftIds.has(id));
  const someVisibleSelected = visibleSchedulableIds.some(id => selectedDraftIds.has(id));
  const hiddenSelectedCount = [...selectedDraftIds].filter(id => !visibleDrafts.some(draft => draft.id === id)).length;
  const toggleDraft = (id: string) => setSelectedDraftIds((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleSelectAllVisible = () => setSelectedDraftIds((current) => {
    const next = new Set(current);
    if (allVisibleSelected) visibleSchedulableIds.forEach((id) => next.delete(id));
    else visibleSchedulableIds.forEach((id) => next.add(id));
    return next;
  });
  const submitBulkSchedule = async () => {
    if (bulkLock.current || !bulkConfirmed || bulkWarnings.length || isBulkScheduling) return;
    const sharedValidation = scheduleTimeValidation(bulkDate, bulkTime, timeZone);
    if (!spreadAcrossWeek && !sharedValidation.publishAt) return;
    const schedule = spreadAcrossWeek ? Object.fromEntries(bulkDrafts.map((draft, index) => [draft.id, spreadSlots[index]?.instant] as const).filter((entry): entry is [string, Date] => Boolean(entry[1]))) : undefined;
    bulkLock.current = true;
    try {
      const consents: Record<string, PublishingConsent> = Object.create(null);
      for (const draft of bulkDrafts) {
        const consent = consentFor(draft);
        if (!consent) return;
        consents[draft.id] = consent;
      }
      const result = await bulkSchedule(Array.from(selectedDraftIds), consents, spreadAcrossWeek ? undefined : sharedValidation.publishAt ?? undefined, schedule);
      await invalidatePublishingQueries();
      if (result) {
        setBulkErrors(result.errors ?? {});
        setSelectedDraftIds(new Set(result.failed));
        if (!result.failed.length) setBulkScheduleOpen(false);
      }
    } finally { bulkLock.current = false; setBulkConfirmedKey(null); }
  };
  const bulkDrafts = draftsList.filter(draft => selectedDraftIds.has(draft.id));
  const spreadSlots = distinctDaySendSlots([...new Set(bulkDrafts.map(draft => draft.platform))], timeZone, new Date(), bulkDrafts.length);
  const bulkConfirmationKey = JSON.stringify(bulkDrafts.map((draft, index) => scheduleConfirmationKey(draft, [draft.platform], spreadAcrossWeek ? spreadSlots[index]?.date ?? "" : bulkDate, spreadAcrossWeek ? spreadSlots[index]?.time ?? "" : bulkTime, timeZone, scheduleData?.items.find(item => item.draftId === draft.id))));
  const bulkConfirmed = bulkConfirmedKey === bulkConfirmationKey;
  const bulkValidation = scheduleTimeValidation(bulkDate, bulkTime, timeZone);
  const bulkWarnings = [...(!spreadAcrossWeek && bulkValidation.error ? [bulkValidation.error] : [])];
  if (spreadAcrossWeek && spreadSlots.length < bulkDrafts.length) bulkWarnings.push("Too many drafts selected to spread across the available window. Reduce the selection or use a single shared time instead.");
  if (selectedDraftIds.size < 1 || selectedDraftIds.size > 50) bulkWarnings.push("Select between 1 and 50 drafts.");
  for (const id of selectedDraftIds) {
    const draft = draftsList.find((item) => item.id === id);
    if (!draft || draft.publishStatus !== "draft" || blockersFor(draft).length) bulkWarnings.push(`Draft ${id} is no longer ready. Clear it from the selection and review its status.`);
  }
  const postingWarnings = postingDraft ? blockersFor(draftsList.find((draft) => draft.id === postingDraft.id) ?? postingDraft) : [];
  const currentPostingDraft = draftsList.find(draft => draft.id === postingDraft?.id) ?? postingDraft;
  const postingDraftMissing = !!postingDraft && !draftsList.some(draft => draft.id === postingDraft.id);
  const manualUnsafe = !!currentPostingDraft && (postingDraftMissing || draftsError || !scheduleData || scheduleError || attemptedDraftIds.has(currentPostingDraft.id) || currentPostingDraft.publishStatus !== "draft" || !!scheduleFor(currentPostingDraft));
  // Own-history lexical check only, informational — never blocks publishing.
  const repetitionCheck = useQuery<{ matches: Array<{ id: string; platform: string; publishedAt: string | null }> }>({
    queryKey: ["drafts-repetition-check", postingDraft?.id, currentPostingDraft?.content],
    queryFn: async ({ signal }) => {
      const result = await (await apiRequest("POST", "/api/drafts/repetition-check", { content: currentPostingDraft!.content, excludeId: postingDraft!.id }, { signal })).json();
      return { matches: Array.isArray(result?.matches) ? result.matches : [] };
    },
    enabled: !!postingDraft && !!currentPostingDraft?.content,
    staleTime: 60_000,
    retry: false,
  });
  // Identity changes fence the old operation even if a refetch later returns
  // the same text. The guard is consulted immediately before external opening.
  const manualContextKey = JSON.stringify([postingDraft?.id, currentPostingDraft?.id, currentPostingDraft?.content,
    currentPostingDraft?.updatedAt, currentPostingDraft?.platform, requestedDraftId, editScope, manualUnsafe, draftsFetching, schedulesFetching, linkedQuery.isFetching]);
  const manualContextRef = useRef({ key: manualContextKey, unsafe: true });
  if (manualContextRef.current.key !== manualContextKey) manualContextRef.current = { key: manualContextKey,
    unsafe: !postingDraft || manualUnsafe || draftsFetching || schedulesFetching || requestedDraftId !== null && linkedQuery.isFetching };
  const manualContext = manualContextRef.current;
  const manualReadGeneration = manualReadEpoch.current;
  if (postingDraftMissing) postingWarnings.push("This draft is no longer available. Nothing can be published or handed off from this stale preview.");
  let deliveryTone: "neutral" | "info" | "success" | "warning" | "error" = "warning";
  if (publishStatus.outcome === "pending") deliveryTone = "info";
  if (publishStatus.outcome === "simulated") deliveryTone = "neutral";
  if (publishStatus.outcome === "published") deliveryTone = "success";
  if (publishStatus.outcome === "attention" && (publishStatus.schedule?.status === "failed" || publishStatus.schedule?.targets?.some(target => target.status === "failed"))) deliveryTone = "error";
  if (publishStatus.error) deliveryTone = "error";
  const editValidation = platformTextValidation(editContent, editingDraft?.platform ?? "", editingDraft ? getPlatformMeta(editingDraft.platform).charLimit : MAX_DRAFT_CHARACTERS);

  const statusLabels: Record<ContentView, string> = {
    all: "All posts",
    ready: "Drafts",
    scheduled: "Scheduled",
    attention: "Needs attention",
    published: "Published",
  };

  return (
    <main className="flex min-w-0 flex-col h-full overflow-hidden">
      <PageHeader
        width="workbench"
        icon={FileText}
        title="Content"
        subtitle="Your saved posts, from first draft to published."
        actions={<><Button asChild variant="outline"><Link href="/dashboard/calendar"><CalendarDays className="h-4 w-4" />Calendar</Link></Button><Button asChild><Link href="/dashboard/create"><Plus className="h-4 w-4" />Create post</Link></Button></>}
      />

      <PageBody as="div" width="workbench" contentClassName="flex min-h-0 flex-col">
        <PageToolbar aria-label="Content filters" className="mb-5 rounded-xl border bg-card/80 p-3 shadow-sm">
          <div className="w-full min-w-0 space-y-4">
            <div role="group" aria-label="Content status" className="flex flex-wrap items-center gap-1">{((["all", "ready", "scheduled", "attention", "published"] as const).map((view) => (
              <Button
                key={view}
                size="sm"
                variant={draftView === view ? "selected" : "ghost"}
                onClick={() => {
                  if (editingDraft && !confirmLeaveEdit()) return;
                  setDraftView(view);
                  setMobilePreview(false);
                  const params = new URLSearchParams(search);
                  params.set("view", view); params.delete("draft");
                  navigate(`${location}?${params}`);
                }}
                aria-pressed={draftView === view}
                data-testid={`tab-${view}`}
              >
                {statusLabels[view]}<span className={`rounded-md px-1.5 py-0.5 text-xs tabular-nums ${draftView === view ? "bg-primary/10" : "bg-muted text-muted-foreground"}`}>{isLoading || draftsError ? "-" : statusCounts[view]}</span>
              </Button>
            )))}</div>
            <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
              <Field label="Search drafts" className="col-span-2 min-w-0" render={props => <div className="relative"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input {...props} type="search" className="pl-9" value={searchQuery} onChange={event => { setSearchQuery(event.target.value); setMobilePreview(false); }} placeholder="Find a saved post..." data-testid="input-search-drafts" /></div>} />
              <Field label="Filter by platform" className="min-w-0" render={props => <NativeSelect {...props} value={platformFilter} onChange={event => { setPlatformFilter(event.target.value); setMobilePreview(false); }} data-testid="select-platform-filter"><option value="all">All platforms</option>{PLATFORMS.map(platform => <option key={platform.value} value={platform.value}>{platform.label}</option>)}</NativeSelect>} />
              <Field label="Sort posts" className="min-w-0" render={props => <NativeSelect {...props} value={sortOrder} onChange={event => setSortOrder(event.target.value)}><option value="updated">Recently updated</option><option value="newest">Newest saved</option><option value="oldest">Oldest saved</option></NativeSelect>} />
            </div>
            {(searchQuery || platformFilter !== "all") && <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground"><span>{visibleDrafts.length} matching {visibleDrafts.length === 1 ? "post" : "posts"}</span><Button variant="ghost" size="sm" onClick={() => { setSearchQuery(""); setPlatformFilter("all"); }}>Clear filters</Button></div>}
            {selectedDraftIds.size > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
              <span className="text-sm font-medium">{selectedDraftIds.size} selected{hiddenSelectedCount > 0 && <span className="font-normal text-muted-foreground"> · {hiddenSelectedCount} not in this view</span>}</span>
              <div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" onClick={() => setSelectedDraftIds(new Set())}>Clear selection</Button><Button size="sm" onClick={() => { setBulkConfirmedKey(null); setSpreadAcrossWeek(false); setBulkTime(preferredTime); setBulkDate(dateKeyInTimeZone(new Date(), timeZone)); setBulkScheduleOpen(true); }}><CalendarPlus className="h-4 w-4" />Schedule {selectedDraftIds.size} selected</Button></div>
            </div>}
          </div>
        </PageToolbar>
        {requestedDraftId !== null && linkedQuery.isError && <div className="mb-4"><WorkflowStatus tone={linkedQuery.error instanceof ApiError && linkedQuery.error.status === 404 ? "warning" : "error"} title={linkedQuery.error instanceof ApiError && linkedQuery.error.status === 404 ? "Linked draft not found" : "Linked draft could not be checked"} actions={<><Button variant="outline" size="sm" onClick={() => void linkedQuery.refetch()}>Retry linked draft</Button><Button variant="outline" size="sm" onClick={clearDraftLink}>Clear draft selection</Button></>}>No other draft was selected. {linkedQuery.error instanceof ApiError && linkedQuery.error.status === 404 ? "The requested draft is missing or inaccessible." : "A read failure is not evidence that the draft was removed. Refresh before publishing."}</WorkflowStatus></div>}
        {requestedDraftId !== null && linkedDraft && <div className="mb-4"><WorkflowStatus tone="info" title="Linked draft selected" actions={<Button variant="outline" size="sm" onClick={clearDraftLink}>Clear draft selection</Button>}>
          Review this saved draft below. Saving, approval and delivery are separate; nothing was scheduled or published.
          {linkedDraft && !linkedDraftVisible && <p>The linked draft is hidden by your current filters.</p>}
        </WorkflowStatus></div>}
        {scheduleError && <div className="mb-4"><WorkflowStatus tone="error" actions={<Button variant="outline" size="sm" onClick={() => void invalidatePublishingQueries()}>Refresh schedule status</Button>}>Schedule details could not be loaded. Direct publishing is disabled until status can be verified.</WorkflowStatus></div>}
        {trackedDraftId && !postingDraft && <div className="mb-4"><WorkflowStatus tone={deliveryTone} actions={<><Button variant="outline" size="sm" onClick={() => setPostingDraft(draftsList.find((draft) => draft.id === trackedDraftId) ?? null)}>View publishing status</Button><Button variant="ghost" size="sm" disabled={isPublishing} onClick={() => setTrackedDraftId(null)}>Dismiss monitor</Button></>}>{publishStatus.error || publishMessage}</WorkflowStatus></div>}
        {isLoading ? (
          <div className="grid gap-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-48 w-full rounded-md" />
            ))}
          </div>
        ) : draftsError && !linkedDraft ? (
          <WorkflowStatus tone="error" actions={<Button variant="outline" onClick={() => void refetchDrafts()}>Try again</Button>}>Content could not be loaded. Your drafts have not been removed.</WorkflowStatus>
        ) : draftsList.length === 0 ? (
          <DashboardEmptyState
            icon={FileText}
            title="No drafts yet"
            description="Create a post from an idea or a Discover article, then save a platform version. It will appear here for review and scheduling."
          />
        ) : (
          <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <section aria-label="Post library" className={`min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm ${mobilePreview ? "hidden xl:block" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
                <div><h2 className="font-semibold">{statusLabels[draftView]} <span className="text-sm font-normal text-muted-foreground">({visibleDrafts.length})</span></h2><p className="mt-1 text-xs text-muted-foreground">Select a post to review and plan.</p></div>
                {visibleSchedulableIds.length > 0 && <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={allVisibleSelected || (someVisibleSelected ? "indeterminate" : false)} onCheckedChange={toggleSelectAllVisible} aria-label="Select all visible drafts" />Select all</label>}
              </div>
              <div ref={postList} className="xl:max-h-[36rem] xl:overflow-y-auto">
                {visibleDrafts.map(draft => <DraftListItem key={draft.id} draft={draft} scheduleInfo={scheduleInfoById.get(draft.id)} timeZone={timeZone}
                  active={previewDraft?.id === draft.id} selected={selectedDraftIds.has(draft.id)}
                  selectable={visibleSchedulableIds.includes(draft.id)} onToggleSelect={() => toggleDraft(draft.id)} onOpen={() => openPreview(draft)} />)}
                {visibleDrafts.length === 0 && <div className="p-8 text-center">
                  <FileText className="mx-auto mb-3 h-7 w-7 text-muted-foreground" /><h3 className="text-sm font-medium">{searchQuery || platformFilter !== "all" ? "No matching posts" : `No ${draftView === "attention" ? "posts needing attention" : statusLabels[draftView].toLowerCase()} yet`}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{searchQuery || platformFilter !== "all" ? "Try another search or clear the filters above." : "Switch to All posts to browse your library, or create something new."}</p>
                </div>}
              </div>
            </section>
            <section ref={previewPanel} id="content-preview" tabIndex={-1} aria-label="Post preview" className={`min-w-0 rounded-xl border bg-card shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${mobilePreview ? "" : "hidden xl:block"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 p-4">
                <h2 className="font-semibold">Post preview</h2>
                <Button variant="ghost" size="sm" className="xl:hidden" onClick={backToPosts}><ChevronLeft className="h-3.5 w-3.5" />Back to posts</Button>
                {previewDraft && <span className="text-xs text-muted-foreground">{previewDraft.content.length.toLocaleString()} characters</span>}
              </div>
              {previewDraft ? <div key={previewDraft.id} ref={previewDraft.id === requestedDraftId ? linkedDraftElement : undefined} tabIndex={previewDraft.id === requestedDraftId ? -1 : undefined} data-linked-draft={previewDraft.id === requestedDraftId || undefined}>
              {previewDraft.id === requestedDraftId && <p className="px-5 pt-4 text-sm font-medium text-primary">Linked draft</p>}
              <DraftCard
                draft={previewDraft}
                scheduleInfo={scheduleInfoById.get(previewDraft.id)}
                timeZone={timeZone}
                canSchedule={!blockersFor(previewDraft).length}
                scheduleBlocker={blockersFor(previewDraft)[0]}
                onResolveScheduling={blockersFor(previewDraft).length && canResolveScheduling(previewDraft) ? () => setSchedulingDraft(previewDraft) : undefined}
                onPost={() => handlePost(previewDraft)}
                onEdit={() => handleEdit(previewDraft)}
                canEdit={editable(previewDraft)}
                onCopyToDraft={() => setCopyingDraft(previewDraft)}
                onSchedule={() => setSchedulingDraft(previewDraft)}
                onCancelSchedule={() => handleCancelSchedule(previewDraft)}
                onRetry={() => handleRetry(previewDraft)}
                onDeleteRequest={() => setDeletingDraft(previewDraft)}
              />
              </div> : <div className="p-8 text-center"><FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="text-sm font-medium">Choose a post to preview</p><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Review the full text and delivery details here before taking an action.</p></div>}
            </section>
          </div>
        )}
      </PageBody>

      <Dialog open={!!editingDraft} onOpenChange={(open) => !open && confirmLeaveEdit()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Draft</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Field id="draft-edit-content" label="Draft content" error={editValidation.error} counter={<>
              {editValidation.length} / {editValidation.maxCharacters} platform characters{editingDraft?.platform === "twitter" ? " (X links count as 23)" : ""}<br />
              {editValidation.rawLength} / {MAX_DRAFT_CHARACTERS} raw characters (UTF-16 application cap)
            </>} render={props =>
            <Textarea
              {...props}
              value={editContent}
              disabled={editSaving}
              onChange={(e) => { if (!editSaveLock.current && editRevisionRef.current.savedId === editingDraft?.id && editScopeRef.current === renderEditScope) setEditRevision(editDraftText(editRevisionRef.current, e.target.value)); }}
              className="min-h-[200px] resize-none"
              placeholder="Your post content..."
              data-testid="textarea-edit-content"
            />
            } />
            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div className={`h-full transition-[width] motion-reduce:transition-none ${editValidation.error ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Math.min((editValidation.length / editValidation.maxCharacters) * 100, 100)}%` }} />
              </div>
            </div>
          </div>
          {editRevision.status === "failed" && <WorkflowStatus tone="error" title="Could not save draft.">{editRevision.error}</WorkflowStatus>}
          <DraftRevisionNotice state={editRevision} disabled={editSaving} onRefresh={() => void refreshEdit()} onResolve={resolveEdit} />
          <DialogFooter>
            <Button variant="outline" disabled={editSaving} onClick={confirmLeaveEdit} data-testid="button-cancel-edit">
              Cancel
            </Button>
            <Button 
              onClick={handleSaveEdit} 
              disabled={draftSaveBlocked(editRevision) || !!editValidation.error}
              data-testid="button-save-edit"
            >
              {editSaving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkScheduleOpen} onOpenChange={value => { if (!bulkLock.current) setBulkScheduleOpen(value); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>Schedule selected drafts</DialogTitle><DialogDescription>Schedule separate saved texts to each draft's own destination, not one text cross-posted to every platform. {spreadAcrossWeek ? "Each draft publishes on its own suggested day below." : `Requested delivery: ${bulkDate} at ${bulkTime} (${timeZone}).`}</DialogDescription></DialogHeader>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={spreadAcrossWeek} disabled={isBulkScheduling} onChange={event => { setSpreadAcrossWeek(event.target.checked); setBulkConfirmedKey(null); }} />Spread across the week (one post per day, suggested platform times) instead of one shared time</label>
          {!spreadAcrossWeek && <div className="grid gap-4 py-3 sm:grid-cols-2"><Field id="bulk-schedule-date" label="Date" render={props => <Input {...props} disabled={isBulkScheduling} type="date" min={dateKeyInTimeZone(new Date(), timeZone)} value={bulkDate} onChange={(event) => setBulkDate(event.target.value)} />} /><Field id="bulk-schedule-time" label={`Time (${timeZone})`} error={bulkValidation.error} render={props => <Input {...props} disabled={isBulkScheduling} type="time" value={bulkTime} onChange={(event) => setBulkTime(event.target.value)} />} /></div>}
          {spreadAcrossWeek && <p className="py-3 text-xs text-muted-foreground">General platform-guidance send times (not personalized to your own engagement).</p>}
          <div className="space-y-3" aria-label="Selected draft confirmations">{bulkDrafts.map((draft, index) => {
            const text = publishingTextValidation(draft.content, draft.platform, readiness);
            const slot = spreadSlots[index];
            return <section key={draft.id} className="min-w-0 rounded-md border p-3 text-sm"><h3 className="font-medium">{getPlatformMeta(draft.platform).label}</h3>{spreadAcrossWeek && <p className="text-xs text-muted-foreground">{slot ? `Scheduled for ${slot.date} at ${slot.time} (${timeZone})` : "No available slot — reduce the selection."}</p>}<p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words">{draft.content}</p><p>{text.length}/{text.maxCharacters} platform characters · {text.rawLength}/{MAX_DRAFT_CHARACTERS} raw characters</p>{draft.media?.map(item => <p key={item.id}>{item.type}: {item.name}</p>)}</section>;
          })}</div>
          <label className="flex min-h-11 items-start gap-2 py-2 text-sm"><input type="checkbox" checked={bulkConfirmed} disabled={isBulkScheduling} onChange={event => setBulkConfirmedKey(event.target.checked ? bulkConfirmationKey : null)} />I confirm these texts, destinations and timezone.</label>
          {bulkWarnings.length > 0 && <WorkflowStatus tone="warning" title="Cannot schedule yet"><ul className="list-disc pl-4">{bulkWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></WorkflowStatus>}
          {Object.keys(bulkErrors).some(id => selectedDraftIds.has(id)) && <WorkflowStatus tone="error" title="Selected drafts need another review"><ul>{Object.entries(bulkErrors).filter(([id]) => selectedDraftIds.has(id)).map(([id, error]) => <li key={id}>{error.message}</li>)}</ul>Nothing will be resubmitted automatically. Review the remaining selection and confirm again.</WorkflowStatus>}
          <DialogFooter><Button variant="outline" disabled={isBulkScheduling} onClick={() => setBulkScheduleOpen(false)}>Cancel</Button><Button disabled={!bulkConfirmed || bulkWarnings.length > 0 || isBulkScheduling} onClick={submitBulkSchedule}>{isBulkScheduling ? "Scheduling…" : `Schedule ${selectedDraftIds.size} drafts`}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {schedulingDraft && <ScheduleArticleModal
        draftId={schedulingDraft.id}
        draftTitle={schedulingDraft.content.slice(0, 70)}
        open={!!schedulingDraft}
        onOpenChange={(open) => !open && setSchedulingDraft(null)}
        onScheduled={() => { void invalidatePublishingQueries(); setSchedulingDraft(null); }}
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
            <div className="bg-muted p-4 rounded-md text-sm whitespace-pre-wrap break-words">
              {currentPostingDraft?.content}
            </div>
            {!!currentPostingDraft?.media?.length && <ul className="text-sm">{currentPostingDraft.media.map(item => <li key={item.id}>{item.type}: {item.name}</li>)}</ul>}
            {currentPostingDraft && readiness.profile?.requirePublishReview && !currentPostingDraft.publishApprovedAt && ["draft", "scheduled", "failed"].includes(currentPostingDraft.publishStatus) && <Button className="mt-3" variant="outline" disabled={approveDraftMutation.isPending || draftsError || postingDraftMissing} onClick={() => approveDraftMutation.mutate(currentPostingDraft)}>I reviewed this exact draft — approve publishing</Button>}
            {approveDraftMutation.isError && <WorkflowStatus tone="error" title="Approval not recorded">{approveDraftMutation.error.message}</WorkflowStatus>}
          </div>
          {!!repetitionCheck.data?.matches?.length && <WorkflowStatus tone="info" title="Looks similar to a past post of yours">
            {repetitionCheck.data.matches[0].publishedAt ? `You posted something very similar on ${new Date(repetitionCheck.data.matches[0].publishedAt).toLocaleDateString()}.` : "You wrote something very similar in another draft."} Make sure that's intentional before publishing again.
          </WorkflowStatus>}
          {postingWarnings.length > 0 && <ul className="list-disc pl-4 text-sm text-muted-foreground">{postingWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          {trackedDraftId === postingDraft?.id && <div className="space-y-2 text-sm"><WorkflowStatus tone={deliveryTone}>{publishStatus.error || publishMessage || "Delivery is unconfirmed. Check status before retrying."}</WorkflowStatus>{publishStatus.schedule && <ScheduleTargetActions item={publishStatus.schedule} />}<Button variant="outline" size="sm" disabled={publishStatus.checking || isPublishing} onClick={publishStatus.recheck}>Check delivery status</Button><Button variant="ghost" size="sm" disabled={isPublishing} onClick={() => { setTrackedDraftId(null); setPostingDraft(null); }}>Dismiss monitor</Button><p>Dismissing does not resolve uncertainty or permit another publication of this draft.</p></div>}
          {manualUnsafe && <WorkflowStatus tone="warning">Manual handoff is disabled while this draft is scheduled, already submitted, unavailable or has uncertain delivery. Check its target status before sending another copy.</WorkflowStatus>}
          {reconfirmDraftId === currentPostingDraft?.id && currentPostingDraft && <WorkflowStatus tone="warning" title="Confirm the latest draft again">The previous request was rejected before admission. Review the refreshed text and targets; this does not send a request.<Button variant="outline" disabled={draftsError || postingDraftMissing || !scheduleData || scheduleError || isPublishing || draftsFetching || schedulesFetching || linkedQuery.isFetching} onClick={() => {
            const remaining = new Set(attemptedDraftIds); remaining.delete(currentPostingDraft.id);
            attemptedDraftIdsRef.current = remaining;
            queryClient.setQueryData(attemptedDraftsKey, [...remaining]); setAttemptedDraftIds(remaining);
            setTrackedDraftId(null); setReconfirmDraftId(null); setPublishMessage("");
          }}>I reviewed the latest draft — enable a new request</Button></WorkflowStatus>}
          {trackedDraftId !== postingDraft?.id && postingDraft && scheduleFor(postingDraft) && <ScheduleTargetActions item={scheduleFor(postingDraft)!} />}
          <DialogFooter className="gap-2 sm:flex-wrap">
            <Button variant="outline" onClick={() => setPostingDraft(null)} data-testid="button-cancel-post">
              Close
            </Button>
            <Button 
              onClick={() => currentPostingDraft && handlePublishNow(currentPostingDraft)}
              disabled={isPublishing || manualPending || reconfirmDraftId === postingDraft?.id || trackedDraftId === postingDraft?.id || postingWarnings.length > 0}
              data-testid="button-publish-now"
            >
              <Send className="w-4 h-4 mr-1.5" />
              {isPublishing ? "Submitting…" : "Publish directly now"}
            </Button>
            {currentPostingDraft && <PlatformComposeAction key={currentPostingDraft.id} platform={currentPostingDraft.platform} text={currentPostingDraft.content}
              disabled={isPublishing || trackedDraftId === postingDraft?.id || manualUnsafe || manualContext.unsafe}
              canProceed={() => manualContextRef.current === manualContext && manualReadEpoch.current === manualReadGeneration && !manualContext.unsafe && !publishLock.current && !attemptedDraftIdsRef.current.has(currentPostingDraft.id)}
              onBusyChange={busy => { manualPendingRef.current = busy; setManualPending(busy); }} testId="button-copy-and-post" />}
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
    </main>
  );
}
