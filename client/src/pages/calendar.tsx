import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock, Eye, FileText, GripVertical, Lightbulb, List, Plus } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/dashboard/page-header";
import { ScheduleArticleModal } from "@/components/schedule-article-modal";
import { ScheduleTargetActions } from "@/components/publishing-target-actions";
import { PublishingPlatformSelector } from "@/components/publishing-platform-selector";
import { getPlatformMeta } from "@/lib/platforms";
import { dateKeyInTimeZone, formatCalendarDate, formatCalendarTime, CALENDAR_TIMEZONES, timeKeyInTimeZone, publishingDefaults, scheduleTimeValidation } from "@/lib/calendar";
import { canChangeSchedule, defaultSchedulePlatforms, fetchPublishingSchedules, invalidatePublishingQueries, selectionBlockers, type PublishingSchedule as Schedule } from "@/lib/publishing";
import { usePublishSchedule } from "@/hooks/use-publish-schedule";
import { usePublishingReadiness } from "@/hooks/use-publishing-readiness";
import type { Draft } from "@shared/schema";

// Preserve the existing public export used by target-recovery regression tests.
export { ScheduleTargetActions } from "@/components/publishing-target-actions";
type CalendarView = "week" | "month" | "list";
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const utcMidnight = (key: string) => new Date(`${key}T00:00:00.000Z`);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

function ScheduledPost({ item, timeZone, onDragStart, onDragEnd, onReschedule }: Readonly<{
  item: Schedule; timeZone: string; onDragStart: () => void; onDragEnd: () => void; onReschedule: () => void;
}>) {
  const movable = canChangeSchedule(item);
  return <article draggable={movable} onDragStart={onDragStart} onDragEnd={onDragEnd} className="min-w-0 rounded-md border border-secondary/25 bg-secondary/10 p-3 text-sm shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Badge variant="outline" className="max-w-full whitespace-normal break-words bg-background text-xs">{item.targets?.map((target) => getPlatformMeta(target.platform).label).join(" + ") || item.draft?.platform || "Post"}</Badge>
      <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3 shrink-0" />{formatCalendarTime(item.scheduledPublishAt, timeZone)} ({timeZone})</span>
    </div>
    <div className="mt-2 flex min-w-0 items-start gap-1.5">{movable && <GripVertical aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}<p className="min-w-0 break-words line-clamp-3 leading-relaxed">{item.draft?.content ?? "Scheduled draft"}</p></div>
    <p className="mt-2 text-xs">Schedule: {item.status || "unknown"}</p>
    <ScheduleTargetActions item={item} />
    {movable && <Button size="sm" variant="outline" className="mt-2" aria-label={`Reschedule ${item.draft?.content.slice(0, 40) || "draft"}`} onClick={onReschedule}>Reschedule</Button>}
  </article>;
}

function DayCell({ day, items, timeZone, isToday, onAdd, onDragStart, onDragEnd, onDrop, onReschedule }: Readonly<{
  day: Date; items: Schedule[]; timeZone: string; isToday: boolean; onAdd: (day: Date) => void;
  onDragStart: (item: Schedule) => void; onDragEnd: () => void; onDrop: () => void; onReschedule: (item: Schedule) => void;
}>) {
  return <section data-calendar-day={dayKey(day)} onDragOver={(event) => event.preventDefault()} onDrop={onDrop} className={`min-w-0 min-h-[180px] rounded-md border bg-card p-3 shadow-sm ${isToday ? "border-secondary/70 ring-1 ring-secondary/30" : "border-border/70"}`}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b pb-3"><h2 className="text-sm font-medium">{formatCalendarDate(day, "UTC", { weekday: "short", month: "short", day: "numeric" })}</h2>{isToday && <Badge variant="secondary">Today</Badge>}</div>
    <Button variant="outline" size="sm" className="w-full text-xs" aria-label={`Schedule draft on ${dayKey(day)}`} onClick={() => onAdd(day)}><Plus className="mr-1 h-3 w-3" />Schedule draft</Button>
    <div className="mt-3 space-y-2">{items.length ? items.map((item) => <ScheduledPost key={item.id} item={item} timeZone={timeZone} onDragStart={() => onDragStart(item)} onDragEnd={onDragEnd} onReschedule={() => onReschedule(item)} />) : <p className="py-4 text-center text-xs text-muted-foreground">No posts planned</p>}</div>
  </section>;
}

export default function CalendarPage() {
  const schedules = useQuery({ queryKey: ["/api/drafts/scheduled?limit=100"], queryFn: ({ signal }) => fetchPublishingSchedules(signal), refetchInterval: 15_000, staleTime: 0 });
  const { data = { items: [] }, isLoading } = schedules;
  const draftsQuery = useQuery<Draft[]>({ queryKey: ["/api/drafts"], refetchInterval: 15_000 });
  const drafts = draftsQuery.data ?? [];
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
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [platformsTouched, setPlatformsTouched] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => dayKey(cursor));
  const [timeOverride, setTimeOverride] = useState<string | null>(null);
  const selectedTime = timeOverride ?? defaults.time;
  const [actionError, setActionError] = useState("");
  const actionLock = useRef(false);
  const { scheduleDraft, reschedule, isLoading: isScheduling } = usePublishSchedule();
  const availableDrafts = drafts.filter((draft) => draft.publishStatus === "draft");
  const selectedDraft = availableDrafts.find((draft) => draft.id === selectedDraftId);
  const savedPlatforms = defaultSchedulePlatforms(selectedDraft, readiness).join(",");
  useEffect(() => { if (scheduleOpen && !platformsTouched) setSelectedPlatforms(savedPlatforms ? savedPlatforms.split(",") : []); }, [scheduleOpen, platformsTouched, savedPlatforms]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(cursor, index)), [cursor]);
  const monthDays = useMemo(() => {
    const first = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
    const start = addDays(first, -first.getUTCDay());
    return Array.from({ length: 42 }, (_, index) => addDays(start, index));
  }, [cursor]);
  const todayKey = dateKeyInTimeZone(new Date(), timeZone);
  const itemsForDay = (day: Date) => data.items.filter((item) => item.status !== "cancelled" && dateKeyInTimeZone(item.scheduledPublishAt, timeZone) === dayKey(day));
  const plannedThisWeek = data.items.filter((item) => item.status === "scheduled" && weekDays.some((day) => dateKeyInTimeZone(item.scheduledPublishAt, timeZone) === dayKey(day))).length;
  const validation = scheduleTimeValidation(selectedDate, selectedTime, timeZone);
  const duplicateSchedule = data.items.some((item) => item.draftId === selectedDraftId && item.status !== "cancelled");
  const safetyWarnings = selectionBlockers(selectedPlatforms, selectedDraft, readiness);
  if (validation.error) safetyWarnings.push(validation.error);
  if (duplicateSchedule) safetyWarnings.push("This draft already has a schedule. Use its reschedule or target recovery controls.");
  if (!selectedDraft) safetyWarnings.push("Choose a ready draft.");
  if (schedules.isError || !schedules.data || draftsQuery.isError) safetyWarnings.push("Draft and schedule status must be available before scheduling.");
  const density = weekDays.map((day) => itemsForDay(day).length);
  const recommendation = Math.max(...density, 0) >= 3 ? "Your busiest day has 3+ posts. Consider a quieter day." : null;
  const openComposer = (day: Date) => {
    setSelectedDate(dayKey(day)); setSelectedDraftId(availableDrafts[0]?.id ?? ""); setPlatformsTouched(false); setSelectedPlatforms([]); setTimeOverride(null); setScheduleOpen(true);
  };
  const confirmSchedule = async () => {
    const checked = scheduleTimeValidation(selectedDate, selectedTime, timeZone);
    if (actionLock.current || safetyWarnings.length || !checked.publishAt) return;
    actionLock.current = true;
    try {
      const result = await scheduleDraft(selectedDraftId, checked.publishAt, selectedPlatforms);
      if (result) setScheduleOpen(false);
    } finally { await invalidatePublishingQueries(); actionLock.current = false; }
  };
  const rescheduleToDay = async (day: Date) => {
    const item = draggedItem;
    setDraggedItem(null);
    if (!item || !canChangeSchedule(item) || actionLock.current) return;
    const draft = drafts.find((candidate) => candidate.id === item.draftId);
    const checked = scheduleTimeValidation(dayKey(day), timeKeyInTimeZone(item.scheduledPublishAt, timeZone), timeZone);
    const warnings = selectionBlockers(item.targets?.map((target) => target.platform) ?? [], draft, readiness);
    if (schedules.isError || draftsQuery.isError || warnings.length || !checked.publishAt) {
      setActionError(checked.error || warnings[0] || "Schedule status is unavailable."); return;
    }
    actionLock.current = true;
    setActionError("");
    try { await reschedule(item.draftId, checked.publishAt); }
    finally { await invalidatePublishingQueries(); actionLock.current = false; }
  };
  const moveCursor = (direction: number) => {
    setCursorTouched(true);
    setCursor((current) => view === "month" ? new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + direction, 1)) : addDays(current, direction * 7));
  };
  const listItems = data.items.filter((item) => item.status !== "cancelled").sort((a, b) => new Date(a.scheduledPublishAt).getTime() - new Date(b.scheduledPublishAt).getTime());

  return <div className="flex h-full flex-col overflow-hidden">
    <PageHeader icon={CalendarDays} title="Publishing Calendar" subtitle={`${plannedThisWeek} posts planned this week · ${timeZone}`} actions={
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border bg-muted/30 p-1">{(["week", "month", "list"] as const).map((mode) => <Button key={mode} size="sm" variant={view === mode ? "secondary" : "ghost"} aria-pressed={view === mode} onClick={() => setView(mode)} className="capitalize">{mode === "list" && <List className="mr-1 h-3.5 w-3.5" />}{mode}</Button>)}</div>
        <Button variant="outline" size="sm" onClick={() => { setCursorTouched(false); setCursor(utcMidnight(todayKey)); }}>Today</Button>
        <Button variant="outline" size="icon" onClick={() => moveCursor(-1)} aria-label="Previous period"><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="outline" size="icon" onClick={() => moveCursor(1)} aria-label="Next period"><ChevronRight className="h-4 w-4" /></Button>
        <Link href="/dashboard/drafts"><Button variant="outline"><FileText className="mr-2 h-4 w-4" />Manage drafts</Button></Link>
      </div>
    } />
    <main className="flex-1 overflow-y-auto p-4 sm:p-6"><div className="mx-auto max-w-7xl space-y-5">
      <section className="flex flex-col gap-3 rounded-md border bg-muted/20 p-4 md:flex-row md:items-center md:justify-between">
        <div><p className="font-medium">Planning queue</p><p className="text-sm text-muted-foreground">{availableDrafts.length} drafts to review for scheduling. Failed or uncertain deliveries need target recovery.</p>{recommendation && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Lightbulb className="h-3.5 w-3.5" />{recommendation}</p>}</div>
        <div className="flex flex-wrap items-center gap-2"><label className="text-xs text-muted-foreground" htmlFor="calendar-timezone">Display & scheduling timezone</label><Select value={timeZone} onValueChange={setZoneOverride}><SelectTrigger id="calendar-timezone" className="w-full sm:w-[220px] bg-background"><SelectValue /></SelectTrigger><SelectContent>{[...new Set([timeZone, ...CALENDAR_TIMEZONES])].map((zone) => <SelectItem key={zone} value={zone}>{zone}</SelectItem>)}</SelectContent></Select></div>
        <Button onClick={() => openComposer(utcMidnight(todayKey))}>Schedule draft</Button>
      </section>
      {(schedules.isError || draftsQuery.isError || actionError) && <div role="alert" className="rounded-md border p-3 text-sm text-destructive">{actionError || "Could not load publishing data. Scheduling is disabled until status is verified."}<Button variant="outline" size="sm" onClick={() => { setActionError(""); void invalidatePublishingQueries(); }}>Refresh status</Button></div>}
      {isLoading ? <p role="status">Loading schedules…</p> : view === "list" ? <div className="space-y-3">{listItems.length ? listItems.map((item) => <div key={item.id}><p className="mb-1 text-sm text-muted-foreground">{formatCalendarDate(item.scheduledPublishAt, timeZone, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</p><ScheduledPost item={item} timeZone={timeZone} onDragStart={() => setDraggedItem(item)} onDragEnd={() => setDraggedItem(null)} onReschedule={() => setReschedulingItem(item)} /></div>) : <p className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">No scheduled posts yet.</p>}</div> :
        <div className={view === "month" ? "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7" : "grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7"}>{(view === "month" ? monthDays : weekDays).map((day) => <DayCell key={dayKey(day)} day={day} items={itemsForDay(day)} timeZone={timeZone} isToday={dayKey(day) === todayKey} onAdd={openComposer} onDragStart={setDraggedItem} onDragEnd={() => setDraggedItem(null)} onDrop={() => void rescheduleToDay(day)} onReschedule={setReschedulingItem} />)}</div>}
    </div></main>
    <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto max-w-2xl">
      <DialogHeader><DialogTitle>Schedule across platforms</DialogTitle><DialogDescription>Direct delivery only, with an independent status per target. All dates and times below use {timeZone}.</DialogDescription></DialogHeader>
      <div className="grid min-w-0 gap-5 md:grid-cols-2"><div className="min-w-0 space-y-4">
        <div><label htmlFor="calendar-draft" className="mb-1 block text-sm font-medium">Draft</label><Select value={selectedDraftId} onValueChange={(value) => { setSelectedDraftId(value); setPlatformsTouched(false); }}><SelectTrigger id="calendar-draft"><SelectValue placeholder="Choose a draft" /></SelectTrigger><SelectContent>{availableDrafts.map((draft) => <SelectItem key={draft.id} value={draft.id}>{getPlatformMeta(draft.platform).label}: {draft.content.slice(0, 50)}</SelectItem>)}</SelectContent></Select></div>
        <PublishingPlatformSelector platforms={selectedPlatforms} onChange={(values) => { setPlatformsTouched(true); setSelectedPlatforms(values); }} draft={selectedDraft} readiness={readiness} disabled={isScheduling} />
        <div className="grid gap-3 sm:grid-cols-2"><div><label htmlFor="calendar-date" className="mb-1 block text-sm font-medium">Date</label><Input id="calendar-date" type="date" min={todayKey} value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></div><div><label htmlFor="calendar-time" className="mb-1 block text-sm font-medium">Time ({timeZone})</label><Input id="calendar-time" type="time" value={selectedTime} onChange={(event) => setTimeOverride(event.target.value)} /></div></div>
      </div><div className="min-w-0 rounded-md border bg-muted/20 p-4"><div className="flex items-center gap-2"><Eye className="h-4 w-4" /><p className="text-sm font-medium">Preview</p></div>{selectedDraft ? <><p className="mt-3 break-words text-sm leading-relaxed">{selectedDraft.content}</p><div className="mt-4 space-y-2">{selectedPlatforms.map((platform) => <div key={platform} className="flex flex-wrap justify-between gap-2 text-xs"><span>{getPlatformMeta(platform).label}</span><span>{selectedDraft.content.length}/{getPlatformMeta(platform).charLimit} characters</span></div>)}</div></> : <p className="mt-3 text-sm text-muted-foreground">Select a draft to preview it.</p>}</div></div>
      {safetyWarnings.length > 0 ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />Cannot schedule yet</p><ul className="mt-1 list-disc pl-6">{safetyWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : <p role="status" className="flex items-center gap-2 text-xs text-success"><CheckCircle2 className="h-4 w-4" />Ready to request scheduling to {selectedPlatforms.length} platforms.</p>}
      <DialogFooter><Button variant="outline" onClick={() => setScheduleOpen(false)}>Cancel</Button><Button disabled={safetyWarnings.length > 0 || isScheduling} onClick={confirmSchedule}>{isScheduling ? "Scheduling…" : `Schedule ${selectedPlatforms.length || ""} platform${selectedPlatforms.length === 1 ? "" : "s"}`}</Button></DialogFooter>
    </DialogContent></Dialog>
    {reschedulingItem && <ScheduleArticleModal draftId={reschedulingItem.draftId} draftTitle={reschedulingItem.draft?.content.slice(0, 70)} schedulingTimeZone={timeZone} open onOpenChange={(open) => { if (!open) setReschedulingItem(null); }} onScheduled={() => void invalidatePublishingQueries()} />}
  </div>;
}
