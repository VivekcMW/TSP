import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, FileText, GripVertical, List, Plus, Search } from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { PageBody, PageHeader, PageToolbar } from "@/components/dashboard/page-header";
import { WorkflowStatus } from "@/components/dashboard/workflow-status";
import { CalendarGrid, calendarStatus, calendarDayKey as dayKey, calendarDay as utcMidnight, shiftCalendarDay as addDays } from "@/components/dashboard/calendar-planner";
import { ScheduleArticleModal } from "@/components/schedule-article-modal";
import { ScheduleTargetActions } from "@/components/publishing-target-actions";
import { PublishingPlatformSelector, SchedulingConfirmation, SchedulingReadinessActions } from "@/components/publishing-platform-selector";
import { getPlatformMeta } from "@/lib/platforms";
import { dateKeyInTimeZone, formatCalendarDate, formatCalendarTime, CALENDAR_TIMEZONES, publishingDefaults, scheduleTimeValidation } from "@/lib/calendar";
import { nextSendSlots } from "@/lib/send-time";
import { canChangeSchedule, defaultSchedulePlatforms, fetchDraftDetails, fetchPublishingSchedules, invalidatePublishingQueries, scheduleConfirmationKey, selectionBlockers, type PublishingSchedule as Schedule } from "@/lib/publishing";
import { ApiError } from "@/lib/queryClient";
import { capturePublishingConsent } from "@shared/publishing-consent";
import { usePublishSchedule } from "@/hooks/use-publish-schedule";
import { usePublishingReadiness } from "@/hooks/use-publishing-readiness";
import type { Draft } from "@shared/schema";

// Preserve the existing public export used by target-recovery regression tests.
export { ScheduleTargetActions } from "@/components/publishing-target-actions";
type CalendarView = "week" | "month" | "list";

function ScheduledPost({ item, timeZone, onDragStart, onDragEnd, onReschedule, highlighted = false }: Readonly<{
  item: Schedule; timeZone: string; onDragStart: () => void; onDragEnd: () => void; onReschedule: () => void; highlighted?: boolean;
}>) {
  const movable = canChangeSchedule(item);
  const status = calendarStatus(item);
  return <article data-linked-draft={highlighted || undefined} draggable={movable} onDragStart={onDragStart} onDragEnd={onDragEnd} className={`min-w-0 rounded-md border border-border p-3 text-sm shadow-sm ${highlighted ? "bg-accent ring-2 ring-primary ring-offset-2" : "bg-card"}`}>
    {highlighted && <p className="mb-2 font-medium text-accent-foreground">Linked draft schedule</p>}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Badge variant="outline" className="max-w-full whitespace-normal break-words bg-background text-xs">{item.targets?.map((target) => getPlatformMeta(target.platform).label).join(" + ") || item.draft?.platform || "Post"}</Badge>
      <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3 shrink-0" />{formatCalendarTime(item.scheduledPublishAt, timeZone)}</span>
    </div>
    <div className="mt-2 flex min-w-0 items-start gap-1.5">{movable && <GripVertical aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}<p className="min-w-0 break-words line-clamp-3 leading-relaxed">{item.draft?.content ?? "Scheduled draft"}</p></div>
    <p className={`mt-2 rounded-md px-2 py-1 text-xs ${status.className}`}>{status.label}</p>
    <ScheduleTargetActions item={item} />
    {movable && <Button size="sm" variant="outline" className="mt-2" aria-label={`Reschedule ${item.draft?.content.slice(0, 40) || "draft"}`} onClick={onReschedule}>Reschedule</Button>}
    <Button asChild size="sm" variant="ghost" className="mt-2"><Link href={`/dashboard/content?draft=${encodeURIComponent(item.draftId)}`}>View in Content</Link></Button>
  </article>;
}

export default function CalendarPage() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const requestedDraftId = new URLSearchParams(search).get("draft");
  const appliedDraftLink = useRef<string | null>(null);
  const dayPanel = useRef<HTMLElement>(null);
  const planningPanel = useRef<HTMLElement>(null);
  const schedules = useQuery({ queryKey: ["/api/drafts/scheduled?limit=100"], queryFn: ({ signal }) => fetchPublishingSchedules(signal), refetchInterval: 15_000, staleTime: 0 });
  const { data = { items: [] }, isLoading } = schedules;
  const draftsQuery = useQuery<Draft[]>({ queryKey: ["/api/drafts"], refetchInterval: 15_000 });
  const linkedQuery = useQuery<Draft>({
    queryKey: [`/api/drafts/${encodeURIComponent(requestedDraftId ?? "")}/details`],
    queryFn: ({ signal }) => fetchDraftDetails(requestedDraftId!, signal),
    enabled: requestedDraftId !== null, retry: false, staleTime: 0, refetchInterval: 15_000,
  });
  const linkedDraft = !linkedQuery.isError ? linkedQuery.data : undefined;
  const drafts = requestedDraftId === null ? draftsQuery.data ?? []
    : [...(draftsQuery.data ?? []).filter(draft => draft.id !== requestedDraftId), ...(linkedDraft ? [linkedDraft] : [])];
  const readiness = usePublishingReadiness();
  const defaults = publishingDefaults(readiness.profile);
  const [view, setView] = useState<CalendarView>("month");
  const [searchText, setSearchText] = useState("");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [zoneOverride, setZoneOverride] = useState<string | null>(null);
  const timeZone = zoneOverride ?? defaults.timeZone;
  const [cursor, setCursor] = useState(() => utcMidnight(dateKeyInTimeZone(new Date(), timeZone)));
  const [cursorTouched, setCursorTouched] = useState(false);
  useEffect(() => { if (!cursorTouched) setCursor(utcMidnight(dateKeyInTimeZone(new Date(), timeZone))); }, [timeZone, cursorTouched]);
  const [draggedItem, setDraggedItem] = useState<Schedule | null>(null);
  const [reschedulingItem, setReschedulingItem] = useState<Schedule | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState<string | undefined>();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [platformsTouched, setPlatformsTouched] = useState(false);
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const [scheduleZone, setScheduleZone] = useState<string | null>(null);
  const schedulingZone = scheduleZone ?? timeZone;
  const [selectedDate, setSelectedDate] = useState(() => dayKey(cursor));
  const [timeOverride, setTimeOverride] = useState<string | null>(null);
  const selectedTime = timeOverride ?? defaults.time;
  const [submitting, setSubmitting] = useState(false);
  const actionLock = useRef(false);
  useEffect(() => {
    // A new URL is not permission to retain the old linked draft while its
    // independent read is pending, forbidden, missing or unavailable.
    appliedDraftLink.current = null;
    setConfirmedKey(null); setSelectedDraftId(""); setSelectedPlatforms([]);
    setScheduleOpen(false); setReschedulingItem(null); setDraggedItem(null);
  }, [requestedDraftId]);
  const { scheduleDraft, isLoading: scheduleLoading } = usePublishSchedule();
  const isScheduling = scheduleLoading || submitting;
  useEffect(() => {
    if (!scheduleOpen || !readiness.profile) return;
    setScheduleZone(current => current ?? timeZone);
    setTimeOverride(current => current ?? defaults.time);
  }, [scheduleOpen, readiness.profile, timeZone, defaults.time]);
  const availableDrafts = drafts.filter((draft) => draft.publishStatus === "draft");
  const selectedDraft = availableDrafts.find((draft) => draft.id === selectedDraftId);
  const savedPlatforms = defaultSchedulePlatforms(selectedDraft, readiness).join(",");
  useEffect(() => {
    if (!scheduleOpen || platformsTouched) return;
    setSelectedPlatforms(savedPlatforms ? savedPlatforms.split(",") : []);
    if (savedPlatforms) setPlatformsTouched(true);
  }, [scheduleOpen, platformsTouched, savedPlatforms]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(cursor, index - cursor.getUTCDay())), [cursor]);
  const monthDays = useMemo(() => {
    const first = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
    const start = addDays(first, -first.getUTCDay());
    const last = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const count = Math.ceil((first.getUTCDay() + last.getUTCDate()) / 7) * 7;
    return Array.from({ length: count }, (_, index) => addDays(start, index));
  }, [cursor]);
  const todayKey = dateKeyInTimeZone(new Date(), timeZone);
  const query = searchText.trim().toLowerCase();
  const visibleItems = data.items.filter(item =>
    (statusFilter === "cancelled" ? item.status === "cancelled" : item.status !== "cancelled") &&
    (statusFilter === "all" || calendarStatus(item).key === statusFilter) &&
    (platformFilter === "all" || item.targets?.some(target => target.platform === platformFilter) || !item.targets?.length && item.draft?.platform === platformFilter) &&
    (!query || `${item.draft?.content ?? ""} ${item.targets?.map(target => getPlatformMeta(target.platform).label).join(" ") ?? ""}`.toLowerCase().includes(query)),
  ).sort((a, b) => new Date(a.scheduledPublishAt).getTime() - new Date(b.scheduledPublishAt).getTime());
  const itemsByDay = new Map<string, Schedule[]>();
  for (const item of visibleItems) {
    const key = dateKeyInTimeZone(item.scheduledPublishAt, timeZone);
    itemsByDay.set(key, [...(itemsByDay.get(key) ?? []), item]);
  }
  const selectedItems = itemsByDay.get(dayKey(cursor)) ?? [];
  const queue = availableDrafts.filter(draft => !data.items.some(item => item.draftId === draft.id && item.status !== "cancelled"));
  const filteredQueue = queue.filter(draft => (platformFilter === "all" || draft.platform === platformFilter) && (!query || draft.content.toLowerCase().includes(query)));
  const filterPlatforms = [...new Set([...data.items.flatMap(item => item.targets?.length ? item.targets.map(target => target.platform) : item.draft ? [item.draft.platform] : []), ...drafts.map(draft => draft.platform), ...(platformFilter === "all" ? [] : [platformFilter])])];
  const periodKey = dayKey(cursor).slice(0, 7);
  const listItems = visibleItems.filter(item => dateKeyInTimeZone(item.scheduledPublishAt, timeZone).startsWith(periodKey));
  const periodLabel = view === "week"
    ? `${formatCalendarDate(weekDays[0], "UTC", { month: "short", day: "numeric" })} - ${formatCalendarDate(weekDays[6], "UTC", { month: "short", day: "numeric", year: "numeric" })}`
    : formatCalendarDate(cursor, "UTC", { month: "long", year: "numeric" });
  const filtered = Boolean(query || platformFilter !== "all" || statusFilter !== "all");
  const clearFilters = () => { setSearchText(""); setPlatformFilter("all"); setStatusFilter("all"); };
  const selectDay = (day: Date, showDetails = false) => {
    setCursorTouched(true); setCursor(day);
    if (showDetails && window.matchMedia("(max-width: 1279px)").matches) {
      requestAnimationFrame(() => dayPanel.current?.scrollIntoView({ block: "start" }));
    }
  };
  const priorSchedule = data.items.find(item => item.draftId === selectedDraftId);
  const consent = selectedDraft && schedules.data ? capturePublishingConsent(selectedDraft, priorSchedule ?? null) : undefined;
  const confirmationKey = scheduleConfirmationKey(selectedDraft, selectedPlatforms, selectedDate, selectedTime, schedulingZone, priorSchedule);
  const confirmed = confirmedKey === confirmationKey;
  const validation = scheduleTimeValidation(selectedDate, selectedTime, schedulingZone);
  const suggestedSlots = nextSendSlots(selectedPlatforms.length ? selectedPlatforms : selectedDraft ? [selectedDraft.platform] : [], schedulingZone, new Date(), 3);
  const duplicateSchedule = data.items.some((item) => item.draftId === selectedDraftId && item.status !== "cancelled");
  const safetyWarnings = selectionBlockers(selectedPlatforms, selectedDraft, readiness);
  if (validation.error) safetyWarnings.push(validation.error);
  if (duplicateSchedule) safetyWarnings.push("This draft already has a schedule. Use its reschedule or target recovery controls.");
  if (!selectedDraft) safetyWarnings.push("Choose a ready draft.");
  if (!consent) safetyWarnings.push("The exact publishing revision is unavailable. Refresh and review before confirming.");
  if (schedules.isError || !schedules.data || draftsQuery.isError) safetyWarnings.push("Draft and schedule status must be available before scheduling.");
  const openComposer = (day: Date, draftId?: string) => {
    const destinationDraft = requestedDraftId !== null ? availableDrafts.find(draft => draft.id === requestedDraftId) : availableDrafts[0];
    setSelectedDate(dayKey(day)); setSelectedDraftId(draftId ?? destinationDraft?.id ?? ""); setPlatformsTouched(false); setSelectedPlatforms([]); setTimeOverride(readiness.profile ? defaults.time : null); setScheduleZone(readiness.profile ? timeZone : null); setConfirmedKey(null); setScheduleOpen(true);
  };
  const linkedSchedule = data.items.find(item => item.draftId === requestedDraftId && item.status !== "cancelled");
  useEffect(() => {
    if (requestedDraftId === null) { appliedDraftLink.current = null; return; }
    if (appliedDraftLink.current === requestedDraftId || actionLock.current || !linkedQuery.isSuccess || linkedQuery.isFetching || !schedules.data || schedules.isError) return;
    appliedDraftLink.current = requestedDraftId;
    setConfirmedKey(null);
    setReschedulingItem(null); setDraggedItem(null);
    if (linkedDraft?.publishStatus === "draft" && !linkedSchedule) {
      openComposer(utcMidnight(todayKey), linkedDraft.id);
    } else {
      // Never substitute the first ready draft for a missing/immutable link or
      // reopen an existing schedule as a fresh publication.
      setSelectedDraftId(""); setSelectedPlatforms([]); setScheduleOpen(false);
      if (linkedSchedule) {
        setView("list"); clearFilters();
        selectDay(utcMidnight(dateKeyInTimeZone(linkedSchedule.scheduledPublishAt, timeZone)));
      }
    }
  }, [requestedDraftId, linkedQuery.data, linkedQuery.isSuccess, linkedQuery.isFetching, schedules.data, schedules.isError]);
  const clearDraftLink = () => {
    const params = new URLSearchParams(search); params.delete("draft");
    const suffix = params.size ? `?${params}` : "";
    navigate(`${location}${suffix}`, { replace: true });
  };
  const confirmSchedule = async () => {
    const checked = scheduleTimeValidation(selectedDate, selectedTime, schedulingZone);
    if (actionLock.current || !confirmed || !consent || safetyWarnings.length || !checked.publishAt) return;
    actionLock.current = true; setSubmitting(true);
    try {
      const result = await scheduleDraft(selectedDraftId, checked.publishAt, consent, selectedPlatforms);
      if (result) setScheduleOpen(false);
    } finally { try { await invalidatePublishingQueries(); } finally { actionLock.current = false; setSubmitting(false); setConfirmedKey(null); } }
  };
  const openReschedule = (item: Schedule) => { setRescheduleDate(undefined); setReschedulingItem(item); };
  const rescheduleToDay = (day: Date) => {
    const item = draggedItem;
    setDraggedItem(null);
    if (!item || !canChangeSchedule(item) || actionLock.current) return;
    // Dragging expresses a proposed date, not consent to publish. The modal
    // rechecks current draft/target state and requires explicit confirmation.
    setRescheduleDate(dayKey(day)); setReschedulingItem(item);
  };
  const moveCursor = (direction: number) => {
    setCursorTouched(true);
    setCursor((current) => view === "week" ? addDays(current, direction * 7) : new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + direction, 1)));
  };

  return <main className="flex h-full min-w-0 flex-col overflow-hidden">
    <PageHeader width="workbench" icon={CalendarDays} title="Calendar" subtitle="Plan your content. Review every post before it goes live." actions={<>
      <Button asChild variant="outline"><Link href="/dashboard/create"><Plus className="h-4 w-4" />Create post</Link></Button>
      <Button onClick={() => openComposer(cursor)}><CalendarDays className="h-4 w-4" />Schedule draft</Button>
    </>} />
    <PageBody as="div" width="workbench" contentClassName="space-y-5">
      <PageToolbar aria-label="Calendar controls">
        <div className="flex w-full min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <h2 className="text-xl font-semibold" aria-live="polite" data-testid="calendar-period">{periodLabel}</h2>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => moveCursor(-1)} aria-label="Previous period"><ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="outline" size="sm" onClick={() => { setCursorTouched(false); setCursor(utcMidnight(todayKey)); }}>Today</Button>
                <Button variant="ghost" size="icon" onClick={() => moveCursor(1)} aria-label="Next period"><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
            <div role="group" aria-label="Calendar view" className="flex gap-1 rounded-lg border bg-muted/30 p-1">
              {(["month", "week", "list"] as const).map(mode => <Button key={mode} size="sm" variant={view === mode ? "selected" : "ghost"} aria-pressed={view === mode} onClick={() => setView(mode)}>
                {mode === "list" && <List className="h-4 w-4" />}{mode === "list" ? "Agenda" : mode === "month" ? "Month" : "Week"}
              </Button>)}
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
            <Field id="calendar-search" label="Search posts" className="col-span-2 min-w-0 lg:col-span-1" render={props => <div className="relative"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input {...props} type="search" value={searchText} onChange={event => setSearchText(event.target.value)} placeholder="Find a post or draft..." className="pl-9" /></div>} />
            <Field id="calendar-platform" label="Platform" className="min-w-0" render={props => <NativeSelect {...props} value={platformFilter} onChange={event => setPlatformFilter(event.target.value)}><option value="all">All platforms</option>{filterPlatforms.map(platform => <option key={platform} value={platform}>{getPlatformMeta(platform).label}</option>)}</NativeSelect>} />
            <Field id="calendar-status" label="Status" className="min-w-0" render={props => <NativeSelect {...props} value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
              <option value="all">All active posts</option><option value="pending">Scheduled</option><option value="published">Published</option><option value="attention">Needs attention</option><option value="simulated">Demo only</option><option value="cancelled">Cancelled</option>
            </NativeSelect>} />
            <Field id="calendar-timezone" label="Display & scheduling timezone" className="col-span-2 min-w-0 lg:col-span-1" render={props => <NativeSelect {...props} value={timeZone} onChange={event => setZoneOverride(event.target.value)}>{[...new Set([timeZone, ...CALENDAR_TIMEZONES])].map(zone => <option key={zone} value={zone}>{zone}</option>)}</NativeSelect>} />
          </div>
          {filtered && <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><span>Filters apply to calendar posts; search and platform also filter the draft queue.</span><Button size="sm" variant="ghost" onClick={clearFilters}>Clear filters</Button></div>}
        </div>
      </PageToolbar>
      {requestedDraftId !== null && linkedQuery.isError && <WorkflowStatus tone={linkedQuery.error instanceof ApiError && linkedQuery.error.status === 404 ? "warning" : "error"} title={linkedQuery.error instanceof ApiError && linkedQuery.error.status === 404 ? "Linked draft not found" : "Linked draft could not be checked"} actions={<><Button variant="outline" onClick={() => void linkedQuery.refetch()}>Retry linked draft</Button><Button variant="outline" onClick={clearDraftLink}>Clear draft selection</Button></>}>No other draft was selected. {linkedQuery.error instanceof ApiError && linkedQuery.error.status === 404 ? "The requested draft is missing or inaccessible." : "A read failure is not evidence that the draft was removed. Refresh before scheduling."}</WorkflowStatus>}
      {requestedDraftId !== null && linkedDraft && <WorkflowStatus tone="info" title="Linked draft" actions={<>
        {(linkedDraft || linkedSchedule) && <Button asChild variant="outline"><Link href={`/dashboard/content?draft=${encodeURIComponent(requestedDraftId)}`}>Review linked draft in Content</Link></Button>}
        <Button variant="outline" onClick={clearDraftLink}>Clear draft selection</Button>
      </>}>
        <p className="whitespace-pre-wrap break-words">{linkedDraft.content}</p><p>{linkedSchedule ? "Its existing schedule is highlighted below. Use reschedule or target recovery; no new schedule was created." : linkedDraft.publishStatus === "draft" ? "Review its readiness, exact text, destinations and timezone before confirming. Nothing was scheduled automatically." : "This draft is not ready for a new schedule. Review its delivery status in Content; no other draft was selected."}</p>
      </WorkflowStatus>}
      {(schedules.isError || draftsQuery.isError) && <WorkflowStatus tone="error" actions={<Button variant="outline" size="sm" onClick={() => void invalidatePublishingQueries()}>Refresh status</Button>}>Could not load publishing data. Scheduling is disabled until status is verified.</WorkflowStatus>}
      {isLoading ? <WorkflowStatus tone="info">Loading your calendar...</WorkflowStatus> : schedules.data && <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section ref={planningPanel} className="min-w-0" aria-label="Publishing plan">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{(view === "week" ? weekDays.reduce((count, day) => count + (itemsByDay.get(dayKey(day))?.length ?? 0), 0) : listItems.length)} posts {view === "week" ? "this week" : "this month"}{filtered ? " match your filters" : ""}</span>
            <div className="flex flex-wrap gap-3"><span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-info" />Scheduled</span><span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-success" />Published</span><span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-warning" />Needs attention</span></div>
          </div>
          {view !== "list" ? <CalendarGrid days={view === "week" ? weekDays : monthDays} selectedDay={cursor} todayKey={todayKey} timeZone={timeZone} week={view === "week"}
            itemsByDay={itemsByDay} dragging={Boolean(draggedItem)} linkedDraftId={requestedDraftId} onSelect={selectDay}
            onDragStart={setDraggedItem} onDragEnd={() => setDraggedItem(null)} onDrop={rescheduleToDay} /> :
            <div className="space-y-5" aria-label="Monthly agenda">
              {listItems.length ? [...new Set(listItems.map(item => dateKeyInTimeZone(item.scheduledPublishAt, timeZone)))].map(key => <section key={key} className="space-y-3">
                <h3 className="border-b pb-2 text-sm font-semibold">{formatCalendarDate(utcMidnight(key), "UTC", { weekday: "long", month: "long", day: "numeric" })}</h3>
                {itemsByDay.get(key)?.map(item => <ScheduledPost key={item.id} item={item} timeZone={timeZone} highlighted={item.draftId === requestedDraftId}
                  onDragStart={() => setDraggedItem(item)} onDragEnd={() => setDraggedItem(null)} onReschedule={() => { selectDay(utcMidnight(key)); openReschedule(item); }} />)}
              </section>) : <div className="rounded-xl border border-dashed bg-card p-8 text-center">
                <CalendarDays className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><h3 className="font-semibold">{filtered ? "No matching posts this month" : "A fresh month to plan"}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{filtered ? "Clear a filter or try another month." : "Choose a draft from the queue to get your next post on the calendar."}</p>
              </div>}
            </div>}
        </section>
        <aside className="min-w-0 space-y-5">
          {view !== "list" && <section ref={dayPanel} aria-label="Selected day" className="overflow-hidden rounded-xl border bg-card">
            <div className="border-b bg-muted/20 p-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">{dayKey(cursor) === todayKey ? "TODAY" : "SELECTED DAY"}</p>
                <Button size="sm" variant="ghost" className="xl:hidden" onClick={() => planningPanel.current?.scrollIntoView({ block: "start" })}><ChevronLeft className="h-3.5 w-3.5" />Back to calendar</Button>
              </div>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold" data-testid="selected-day-heading">{formatCalendarDate(cursor, "UTC", { weekday: "long", month: "long", day: "numeric" })}</h3>
                <div className="flex shrink-0"><Button variant="ghost" size="compact" aria-label="Previous day" onClick={() => selectDay(addDays(cursor, -1))}><ChevronLeft className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="compact" aria-label="Next day" onClick={() => selectDay(addDays(cursor, 1))}><ChevronRight className="h-3.5 w-3.5" /></Button></div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Times in {timeZone}</p>
              <Button variant="outline" size="sm" className="mt-3 w-full" aria-label={`Schedule draft on ${dayKey(cursor)}`} onClick={() => openComposer(cursor)}><Plus className="h-4 w-4" />Add a post</Button>
            </div>
            <div className="space-y-3 p-4">
              {selectedItems.length ? selectedItems.map(item => <ScheduledPost key={item.id} item={item} timeZone={timeZone} highlighted={item.draftId === requestedDraftId}
                onDragStart={() => setDraggedItem(item)} onDragEnd={() => setDraggedItem(null)} onReschedule={() => openReschedule(item)} />) :
                <div className="py-5 text-center"><CalendarDays className="mx-auto mb-2 h-6 w-6 text-muted-foreground" /><p className="text-sm font-medium">{filtered ? "No matching posts on this day" : "Nothing planned yet"}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{filtered ? "Try clearing your filters." : "Select a draft below or add a post to start planning."}</p></div>}
            </div>
          </section>}
          <section aria-label="Draft queue" className="rounded-xl border bg-card">
            <div className="border-b p-4"><div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Draft queue</h3>{!draftsQuery.isError && !draftsQuery.isLoading && <Badge variant="secondary">{filteredQueue.length}</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">Not scheduled yet. Review before publishing.</p></div>
            <div className="max-h-96 space-y-3 overflow-y-auto p-4">
              {draftsQuery.isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading drafts...</p> : draftsQuery.isError ? <p className="text-sm text-destructive">Drafts could not be loaded. Use Refresh status to retry.</p> : filteredQueue.length ? filteredQueue.map(draft => {
                const platform = getPlatformMeta(draft.platform), Icon = platform.icon;
                return <article key={draft.id} className="rounded-lg border p-3" data-testid={`queue-draft-${draft.id}`}>
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Icon className="h-3.5 w-3.5" />{platform.label}</div>
                  <p className="mt-2 line-clamp-3 break-words text-sm leading-relaxed">{draft.content}</p>
                  <div className="mt-3 flex flex-wrap gap-1"><Button size="sm" variant="outline" onClick={() => openComposer(cursor, draft.id)} aria-label={`Plan ${platform.label} draft: ${draft.content.slice(0, 40)}`}>Plan post</Button><Button asChild size="sm" variant="ghost"><Link href={`/dashboard/content?draft=${encodeURIComponent(draft.id)}`}>Edit draft</Link></Button></div>
                </article>;
              }) : <div className="py-4 text-center"><FileText className="mx-auto mb-2 h-6 w-6 text-muted-foreground" /><p className="text-sm font-medium">{query || platformFilter !== "all" ? "No matching drafts" : "Your queue is clear"}</p><p className="mt-1 text-xs text-muted-foreground">Save a post in Content to plan it here.</p><Button asChild size="sm" variant="outline" className="mt-3"><Link href="/dashboard/create">Create a post</Link></Button></div>}
            </div>
            <div className="border-t px-4 py-2"><Button asChild size="sm" variant="ghost" className="w-full"><Link href="/dashboard/content">Manage all drafts</Link></Button></div>
          </section>
        </aside>
      </div>}
    </PageBody>
    <Sheet open={scheduleOpen} onOpenChange={value => { if (!actionLock.current) setScheduleOpen(value); }}><SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg motion-reduce:!animate-none">
      <SheetHeader className="space-y-1 border-b border-border px-6 py-4 pr-16 text-left"><SheetTitle className="text-base leading-6">Plan your post</SheetTitle><SheetDescription>Choose a draft, set a time, then review and confirm. Nothing is published automatically by opening this panel.</SheetDescription></SheetHeader>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
        <Field id="calendar-draft" label="Draft" render={props => <NativeSelect {...props} disabled={isScheduling} value={selectedDraft?.id ?? ""} onChange={event => { setSelectedDraftId(event.target.value); setSelectedPlatforms([]); setPlatformsTouched(false); setConfirmedKey(null); }}><option value="">Choose a draft</option>{availableDrafts.map(draft => <option key={draft.id} value={draft.id}>{getPlatformMeta(draft.platform).label}: {draft.content.slice(0, 50)}</option>)}</NativeSelect>} />
        <PublishingPlatformSelector platforms={selectedPlatforms} onChange={(values) => { setPlatformsTouched(true); setSelectedPlatforms(values); }} draft={selectedDraft} readiness={readiness} disabled={isScheduling} />
        <div className="grid items-start gap-4 sm:grid-cols-2"><Field id="calendar-date" label="Date" render={props => <Input {...props} disabled={isScheduling} type="date" min={dateKeyInTimeZone(new Date(), schedulingZone)} value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />} /><Field id="calendar-time" label={`Time (${schedulingZone})`} error={validation.error} render={props => <Input {...props} disabled={isScheduling} type="time" value={selectedTime} onChange={(event) => setTimeOverride(event.target.value)} />} /></div>
        <div className="space-y-1.5"><p className="text-xs font-medium text-muted-foreground">Suggested times (general platform guidance, not personalized)</p><div className="flex flex-wrap gap-2">{suggestedSlots.map(slot => <Button key={`${slot.date}T${slot.time}`} type="button" size="sm" variant="outline" disabled={isScheduling} onClick={() => { setSelectedDate(slot.date); setTimeOverride(slot.time); }} data-testid={`button-suggested-time-${slot.date}-${slot.time}`}>{formatCalendarDate(slot.instant, schedulingZone, { weekday: "short", month: "short", day: "numeric" })} · {formatCalendarTime(slot.instant, schedulingZone)}</Button>)}</div></div>
        <SchedulingReadinessActions key={selectedDraftId} draft={selectedDraft} platforms={selectedPlatforms} readiness={readiness} disabled={isScheduling || draftsQuery.isError || schedules.isError || !schedules.data || duplicateSchedule} />
        <SchedulingConfirmation draft={selectedDraft} platforms={selectedPlatforms} date={selectedDate} time={selectedTime} timeZone={schedulingZone} readiness={readiness} confirmed={confirmed} onConfirm={value => setConfirmedKey(value ? confirmationKey : null)} disabled={isScheduling} />
        {safetyWarnings.length > 0 && <WorkflowStatus tone={schedules.isError || draftsQuery.isError ? "error" : "warning"} title="Cannot schedule yet"><ul className="list-disc space-y-1 pl-4">{safetyWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></WorkflowStatus>}
      </div>
      <SheetFooter className="gap-2 border-t border-border bg-card px-6 py-4 sm:space-x-0"><Button variant="outline" disabled={isScheduling} onClick={() => setScheduleOpen(false)}>Cancel</Button><Button disabled={!confirmed || safetyWarnings.length > 0 || isScheduling} onClick={confirmSchedule}>{isScheduling ? "Scheduling…" : `Schedule ${selectedPlatforms.length || ""} platform${selectedPlatforms.length === 1 ? "" : "s"}`}</Button></SheetFooter>
    </SheetContent></Sheet>
    {reschedulingItem && <ScheduleArticleModal draftId={reschedulingItem.draftId} draftTitle={reschedulingItem.draft?.content.slice(0, 70)} schedulingTimeZone={timeZone} initialPublishDate={rescheduleDate} open onOpenChange={(open) => { if (!open) setReschedulingItem(null); }} onScheduled={() => void invalidatePublishingQueries()} />}
  </main>;
}
