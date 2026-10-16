import { useEffect, useId, useRef } from "react";
import { formatCalendarDate, formatCalendarTime } from "@/lib/calendar";
import { getPlatformMeta } from "@/lib/platforms";
import { canChangeSchedule, publishingStatus as calendarStatus, type PublishingSchedule } from "@/lib/publishing";
export { publishingStatus as calendarStatus } from "@/lib/publishing";

export const calendarDayKey = (date: Date) => date.toISOString().slice(0, 10);
export const calendarDay = (key: string) => new Date(`${key}T00:00:00.000Z`);
export const shiftCalendarDay = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

interface CalendarGridProps {
  days: Date[];
  selectedDay: Date;
  todayKey: string;
  timeZone: string;
  week: boolean;
  itemsByDay: Map<string, PublishingSchedule[]>;
  dragging: boolean;
  linkedDraftId: string | null;
  onSelect: (day: Date, showDetails?: boolean) => void;
  onDragStart: (item: PublishingSchedule) => void;
  onDragEnd: () => void;
  onDrop: (day: Date) => void;
}

export function CalendarGrid({ days, selectedDay, todayKey, timeZone, week, itemsByDay, dragging, linkedDraftId, onSelect, onDragStart, onDragEnd, onDrop }: Readonly<CalendarGridProps>) {
  const grid = useRef<HTMLDivElement>(null);
  const focusDay = useRef<string>();
  const instructions = useId();
  const selectedKey = calendarDayKey(selectedDay);
  useEffect(() => {
    if (!focusDay.current) return;
    grid.current?.querySelector<HTMLButtonElement>(`[data-select-day="${focusDay.current}"]`)?.focus();
    focusDay.current = undefined;
  }, [selectedDay]);
  return <div>
    <p id={instructions} className="sr-only">Use the arrow keys to select a day. Home and End move within a week. Page Up and Page Down change the month.</p>
    <div ref={grid} role="group" aria-label={week ? "Week calendar" : "Month calendar"} aria-describedby={instructions} className="overflow-hidden rounded-xl border bg-card">
      <div className="grid grid-cols-7 border-b bg-muted/30">
        {days.slice(0, 7).map(day => <div key={calendarDayKey(day)} className="py-3 text-center text-xs font-medium text-muted-foreground">
          {formatCalendarDate(day, "UTC", { weekday: "short" })}
        </div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map(day => {
          const key = calendarDayKey(day), selected = key === selectedKey, today = key === todayKey;
          const outside = !week && day.getUTCMonth() !== selectedDay.getUTCMonth();
          const items = itemsByDay.get(key) ?? [];
          const dateLabel = formatCalendarDate(day, "UTC", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
          return <section key={key} data-calendar-day={key}
            onDragOver={event => { if (dragging) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
            onDrop={event => { event.preventDefault(); onDrop(day); }}
            className={`min-w-0 border-b border-r p-0.5 sm:p-1.5 ${week ? "min-h-24 md:min-h-64" : "min-h-16 md:min-h-24"} ${selected ? "bg-primary/5 ring-1 ring-inset ring-primary" : outside ? "bg-muted/25" : ""} ${dragging ? "hover:bg-accent" : ""}`}>
            <button type="button" data-select-day={key} aria-label={`${dateLabel}, ${items.length} ${items.length === 1 ? "post" : "posts"}`}
              aria-current={today ? "date" : undefined} aria-pressed={selected} tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(day, true)}
              onKeyDown={event => {
                const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -day.getUTCDay(), End: 6 - day.getUTCDay() };
                let next: Date;
                if (event.key in offsets) next = shiftCalendarDay(day, offsets[event.key]);
                else if (event.key === "PageUp" || event.key === "PageDown") next = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + (event.key === "PageUp" ? -1 : 1), 1));
                else return;
                event.preventDefault(); focusDay.current = calendarDayKey(next); onSelect(next);
              }}
              className={`flex min-h-11 w-full items-center justify-center gap-1 rounded-md text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8 md:justify-start ${outside ? "text-muted-foreground" : "text-foreground"}`}>
              <time dateTime={key} className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${today ? "bg-primary font-semibold text-primary-foreground" : selected ? "bg-accent font-semibold text-accent-foreground" : ""}`}>{day.getUTCDate()}</time>
              {!!items.length && <span className="hidden text-xs text-muted-foreground md:inline">{items.length}</span>}
            </button>
            {!!items.length && <div aria-hidden="true" className="flex justify-center gap-0.5 pb-1 md:hidden">
              {items.slice(0, 3).map(item => <span key={item.id} className={`h-1.5 w-1.5 rounded-full ${calendarStatus(item).dot}`} />)}
              {items.length > 3 && <span className="text-xs leading-none">+</span>}
            </div>}
            <div className="hidden space-y-1 md:block">
              {items.slice(0, week ? 4 : 2).map(item => {
                const status = calendarStatus(item);
                const platform = getPlatformMeta(item.targets?.[0]?.platform ?? item.draft?.platform ?? "");
                const Icon = platform.icon;
                return <article key={item.id} draggable={canChangeSchedule(item)} onDragStart={event => {
                  event.dataTransfer.setData("text/plain", item.id); event.dataTransfer.effectAllowed = "move"; onDragStart(item);
                }} onDragEnd={onDragEnd} className={`min-w-0 rounded-md ${status.className} ${item.draftId === linkedDraftId ? "ring-2 ring-primary" : ""}`}>
                  <button type="button" tabIndex={-1} onClick={() => onSelect(day, true)} title={item.draft?.content}
                    aria-label={`${formatCalendarTime(item.scheduledPublishAt, timeZone)}, ${platform.label}, ${status.label}: ${item.draft?.content ?? "Scheduled draft"}`}
                    className="block w-full min-w-0 rounded-md px-1.5 py-1 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="flex min-w-0 flex-wrap items-center gap-1"><Icon className="h-3 w-3 shrink-0" /><span className="min-w-0 font-medium [overflow-wrap:anywhere]">{formatCalendarTime(item.scheduledPublishAt, timeZone)}</span>{week && (item.targets?.length ?? 0) > 1 && <span>+{item.targets!.length - 1}</span>}</span>
                    <span className="mt-0.5 block truncate">{item.draft?.content || "Scheduled draft"}</span>
                  </button>
                </article>;
              })}
              {items.length > (week ? 4 : 2) && <button type="button" tabIndex={-1} onClick={() => onSelect(day, true)} className="min-h-8 w-full rounded-md text-left text-xs font-medium text-primary">+{items.length - (week ? 4 : 2)} more</button>}
            </div>
          </section>;
        })}
      </div>
    </div>
    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Select a day to plan or review posts. Drag a scheduled post to propose a new date; you will confirm before anything changes.</p>
  </div>;
}
