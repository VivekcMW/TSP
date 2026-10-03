import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, FileText, GripVertical, Lightbulb, List, Plus } from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { PageBody, PageHeader, PageToolbar } from "@/components/dashboard/page-header";
import { WorkflowStatus } from "@/components/dashboard/workflow-status";
import { ScheduleArticleModal } from "@/components/schedule-article-modal";
import { ScheduleTargetActions } from "@/components/publishing-target-actions";
import { PublishingPlatformSelector, SchedulingConfirmation, SchedulingReadinessActions } from "@/components/publishing-platform-selector";
import { getPlatformMeta } from "@/lib/platforms";
import { dateKeyInTimeZone, formatCalendarDate, formatCalendarTime, CALENDAR_TIMEZONES, publishingDefaults, scheduleTimeValidation } from "@/lib/calendar";
import { nextSendSlots } from "@/lib/send-time";
import { canChangeSchedule, defaultSchedulePlatforms, fetchDraftDetails, fetchPublishingSchedules, invalidatePublishingQueries, publicationOutcome, scheduleConfirmationKey, selectionBlockers, type PublishingSchedule as Schedule } from "@/lib/publishing";
import { ApiError } from "@/lib/queryClient";
import { capturePublishingConsent } from "@shared/publishing-consent";
import { usePublishSchedule } from "@/hooks/use-publish-schedule";
import { usePublishingReadiness } from "@/hooks/use-publishing-readiness";
import type { Draft } from "@shared/schema";

// Preserve the existing public export used by target-recovery regression tests.
export { ScheduleTargetActions } from "@/components/publishing-target-actions";
type CalendarView = "week" | "month" | "list";
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const utcMidnight = (key: string) => new Date(`${key}T00:00:00.000Z`);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

function ScheduledPost({ item, timeZone, onDragStart, onDragEnd, onReschedule, highlighted = false }: Readonly<{
  item: Schedule; timeZone: string; onDragStart: () => void; onDragEnd: () => void; onReschedule: () => void; highlighted?: boolean;
}>) {
  const movable = canChangeSchedule(item);
  const outcome = publicationOutcome(item);
  let stateClass = "bg-warning-subtle text-warning";
  if (outcome === "pending") stateClass = "bg-info-subtle text-info";
  if (outcome === "published") stateClass = "bg-success-subtle text-success";
  if (outcome === "simulated" || item.status === "cancelled") stateClass = "bg-muted text-muted-foreground";
  if (item.status === "failed" || item.targets?.some(target => target.status === "failed")) stateClass = "bg-destructive-subtle text-destructive";
  if (item.targets?.some(target => ["unknown", "accepted_unverified", "legacy_unverified"].includes(target.status))) stateClass = "bg-warning-subtle text-warning";
  return <article data-linked-draft={highlighted || undefined} draggable={movable} onDragStart={onDragStart} onDragEnd={onDragEnd} className={`min-w-0 rounded-md border border-border p-3 text-sm shadow-sm ${highlighted ? "bg-accent ring-2 ring-primary ring-offset-2" : "bg-card"}`}>
    {highlighted && <p className="mb-2 font-medium text-accent-foreground">Linked draft schedule</p>}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Badge variant="outline" className="max-w-full whitespace-normal break-words bg-background text-xs">{item.targets?.map((target) => getPlatformMeta(target.platform).label).join(" + ") || item.draft?.platform || "Post"}</Badge>
      <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3 shrink-0" />{formatCalendarTime(item.scheduledPublishAt, timeZone)} ({timeZone})</span>
    </div>
    <div className="mt-2 flex min-w-0 items-start gap-1.5">{movable && <GripVertical aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}<p className="min-w-0 break-words line-clamp-3 leading-relaxed">{item.draft?.content ?? "Scheduled draft"}</p></div>
    <p className={`mt-2 rounded-md px-2 py-1 text-xs ${stateClass}`}>Schedule: {item.status || "unknown"}</p>
    <ScheduleTargetActions item={item} />
    {movable && <Button size="sm" variant="outline" className="mt-2" aria-label={`Reschedule ${item.draft?.content.slice(0, 40) || "draft"}`} onClick={onReschedule}>Reschedule</Button>}
  </article>;
}

function DayCell({ day, items, timeZone, isToday, onAdd, onDragStart, onDragEnd, onDrop, onReschedule, linkedDraftId }: Readonly<{
  day: Date; items: Schedule[]; timeZone: string; isToday: boolean; onAdd: (day: Date) => void;
  onDragStart: (item: Schedule) => void; onDragEnd: () => void; onDrop: () => void; onReschedule: (item: Schedule) => void;
  linkedDraftId: string | null;
}>) {
  return <section data-calendar-day={dayKey(day)} onDragOver={(event) => event.preventDefault()} onDrop={onDrop} className={`min-w-0 min-h-[180px] rounded-md border bg-card p-3 shadow-sm ${isToday ? "border-primary ring-1 ring-primary" : "border-border"}`}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b pb-3"><h2 className="text-sm font-medium">{formatCalendarDate(day, "UTC", { weekday: "short", month: "short", day: "numeric" })}</h2>{isToday && <Badge variant="outline" className="border-primary bg-accent text-accent-foreground">Today</Badge>}</div>
    <Button variant="outline" size="sm" className="w-full" aria-label={`Schedule draft on ${dayKey(day)}`} onClick={() => onAdd(day)}><Plus className="h-4 w-4" />Schedule draft</Button>
    <div className="mt-3 space-y-2">{items.length ? items.map((item) => <ScheduledPost key={item.id} item={item} timeZone={timeZone} highlighted={item.draftId === linkedDraftId} onDragStart={() => onDragStart(item)} onDragEnd={onDragEnd} onReschedule={() => onReschedule(item)} />) : <p className="py-4 text-center text-xs text-muted-foreground">No posts planned</p>}</div>
  </section>;
}

export default function CalendarPage() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const requestedDraftId = new URLSearchParams(search).get("draft");
  const appliedDraftLink = useRef<string | null>(null);
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
  const [view, setView] = useState<CalendarView>("week");
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
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(cursor, index)), [cursor]);
  const monthDays = useMemo(() => {
    const first = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
    const start = addDays(first, -first.getUTCDay());
    return Array.from({ length: 42 }, (_, index) => addDays(start, index));
  }, [cursor]);
  const todayKey = dateKeyInTimeZone(new Date(), timeZone);
  const itemsForDay = (day: Date) => data.items.filter((item) => item.status !== "cancelled" && dateKeyInTimeZone(item.scheduledPublishAt, timeZone) === dayKey(day));
  const plannedThisWeek = data.items.filter((item) => item.status === "scheduled" && weekDays.some((day) => dateKeyInTimeZone(item.scheduledPublishAt, timeZone) === dayKey(day))).length;
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
  const density = weekDays.map((day) => itemsForDay(day).length);
  const recommendation = Math.max(...density, 0) >= 3 ? "Your busiest day has 3+ posts. Consider a quieter day." : null;
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
      if (linkedSchedule) setView("list");
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
    setCursor((current) => view === "month" ? new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + direction, 1)) : addDays(current, direction * 7));
  };
  const listItems = data.items.filter((item) => item.status !== "cancelled").sort((a, b) => new Date(a.scheduledPublishAt).getTime() - new Date(b.scheduledPublishAt).getTime());

  return <main className="flex h-full min-w-0 flex-col overflow-hidden">
    <PageHeader width="workbench" icon={CalendarDays} title="Publishing Calendar" subtitle={`${plannedThisWeek} posts planned this week · ${timeZone}`} actions={<Button onClick={() => openComposer(utcMidnight(todayKey))}>Schedule draft</Button>} />
    <PageBody as="div" width="workbench" contentClassName="space-y-4">
      <PageToolbar aria-label="Calendar controls" actions={<Button asChild variant="outline"><Link href="/dashboard/content"><FileText className="h-4 w-4" />Manage drafts</Link></Button>}>
        <div className="flex flex-wrap gap-2">{(["week", "month", "list"] as const).map((mode) => <Button key={mode} size="sm" variant={view === mode ? "selected" : "secondary"} aria-pressed={view === mode} onClick={() => setView(mode)} className="capitalize">{mode === "list" && <List className="h-4 w-4" />}{mode}</Button>)}</div>
        <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => { setCursorTouched(false); setCursor(utcMidnight(todayKey)); }}>Today</Button>
        <Button variant="outline" size="icon" onClick={() => moveCursor(-1)} aria-label="Previous period"><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="outline" size="icon" onClick={() => moveCursor(1)} aria-label="Next period"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <Field id="calendar-timezone" label="Display & scheduling timezone" className="flex-1 basis-56" render={props => <NativeSelect {...props} value={timeZone} onChange={event => setZoneOverride(event.target.value)}>{[...new Set([timeZone, ...CALENDAR_TIMEZONES])].map(zone => <option key={zone} value={zone}>{zone}</option>)}</NativeSelect>} />
      </PageToolbar>
      {requestedDraftId !== null && linkedQuery.isError && <WorkflowStatus tone={linkedQuery.error instanceof ApiError && linkedQuery.error.status === 404 ? "warning" : "error"} title={linkedQuery.error instanceof ApiError && linkedQuery.error.status === 404 ? "Linked draft not found" : "Linked draft could not be checked"} actions={<><Button variant="outline" onClick={() => void linkedQuery.refetch()}>Retry linked draft</Button><Button variant="outline" onClick={clearDraftLink}>Clear draft selection</Button></>}>No other draft was selected. {linkedQuery.error instanceof ApiError && linkedQuery.error.status === 404 ? "The requested draft is missing or inaccessible." : "A read failure is not evidence that the draft was removed. Refresh before scheduling."}</WorkflowStatus>}
      {requestedDraftId !== null && linkedDraft && <WorkflowStatus tone="info" title="Linked draft" actions={<>
        {(linkedDraft || linkedSchedule) && <Button asChild variant="outline"><Link href={`/dashboard/content?draft=${encodeURIComponent(requestedDraftId)}`}>Review linked draft in Content</Link></Button>}
        <Button variant="outline" onClick={clearDraftLink}>Clear draft selection</Button>
      </>}>
        <p className="whitespace-pre-wrap break-words">{linkedDraft.content}</p><p>{linkedSchedule ? "Its existing schedule is highlighted below. Use reschedule or target recovery; no new schedule was created." : linkedDraft.publishStatus === "draft" ? "Review its readiness, exact text, destinations and timezone before confirming. Nothing was scheduled automatically." : "This draft is not ready for a new schedule. Review its delivery status in Content; no other draft was selected."}</p>
      </WorkflowStatus>}
      <section className="flex flex-col gap-3 rounded-md border bg-muted/20 p-4 md:flex-row md:items-center md:justify-between">
        <div><h2 className="font-medium">Planning queue</h2><p className="text-sm text-muted-foreground">{availableDrafts.length} drafts to review for scheduling. Failed or uncertain deliveries need target recovery.</p>{recommendation && <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Lightbulb className="h-4 w-4" />{recommendation}</p>}</div>
      </section>
      {(schedules.isError || draftsQuery.isError) && <WorkflowStatus tone="error" actions={<Button variant="outline" size="sm" onClick={() => void invalidatePublishingQueries()}>Refresh status</Button>}>Could not load publishing data. Scheduling is disabled until status is verified.</WorkflowStatus>}
      {isLoading ? <WorkflowStatus tone="info">Loading schedules…</WorkflowStatus> : view === "list" ? <div className="space-y-3">{listItems.length ? listItems.map((item) => <div key={item.id}><p className="mb-1 text-sm text-muted-foreground">{formatCalendarDate(item.scheduledPublishAt, timeZone, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</p><ScheduledPost item={item} timeZone={timeZone} highlighted={item.draftId === requestedDraftId} onDragStart={() => setDraggedItem(item)} onDragEnd={() => setDraggedItem(null)} onReschedule={() => openReschedule(item)} /></div>) : !schedules.isError && <WorkflowStatus tone="neutral">No scheduled posts yet.</WorkflowStatus>}</div> :
        <div className={view === "month" ? "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7" : "grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7"}>{(view === "month" ? monthDays : weekDays).map((day) => <DayCell key={dayKey(day)} day={day} items={itemsForDay(day)} timeZone={timeZone} isToday={dayKey(day) === todayKey} onAdd={openComposer} onDragStart={setDraggedItem} onDragEnd={() => setDraggedItem(null)} onDrop={() => rescheduleToDay(day)} onReschedule={openReschedule} linkedDraftId={requestedDraftId} />)}</div>}
    </PageBody>
    <Sheet open={scheduleOpen} onOpenChange={value => { if (!actionLock.current) setScheduleOpen(value); }}><SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg motion-reduce:!animate-none">
      <SheetHeader className="space-y-1 border-b border-border px-6 py-4 pr-16 text-left"><SheetTitle className="text-base leading-6">Schedule across platforms</SheetTitle><SheetDescription>Publish one saved draft to up to four platforms. Times use {schedulingZone}.</SheetDescription></SheetHeader>
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
