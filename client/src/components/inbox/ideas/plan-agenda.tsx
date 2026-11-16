import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Flag, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useIdeaActions } from "@/components/inbox/ideas/use-idea-actions";
import { useIsSignedIn } from "@/lib/dev-auth";
import { PLAN_DAYS, planQuery, strategyQuery, useMoments } from "@/lib/strategy-queries";
import { cn } from "@/lib/utils";
import { addDays, groupPlanByWeek, placeMoments, shortDate, suggestStrategy, weekdayOf, type PlanEntry } from "@shared/topic-ideas";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const dayLabel = (date: string) => `${WEEKDAYS[weekdayOf(date)]} ${shortDate(date)}`;
const SCHEDULED_HREF = "/dashboard?folder=scheduled";
const STRATEGY_HREF = "/dashboard?folder=ideas&view=strategy";

/** The plan with moments merged in (moments come from Phase 5 and may be absent). */
export function usePlanEntries(days = PLAN_DAYS) {
  const signedIn = Boolean(useIsSignedIn());
  const moments = useMoments(signedIn);
  const plan = useQuery(planQuery(days, moments.extra, signedIn && moments.ready));
  const strategy = useQuery(strategyQuery(signedIn));
  const entries = useMemo(() => plan.data
    ? placeMoments(plan.data, moments.moments, strategy.data?.strategy ?? strategy.data?.suggested ?? suggestStrategy(null))
    : [], [plan.data, moments.moments, strategy.data]);
  return { plan, entries };
}

/** One agenda row: a scheduled post, a suggested idea, an open slot or an industry moment. */
export function PlanRow({ entry, compact = false }: Readonly<{ entry: PlanEntry; compact?: boolean }>) {
  const actions = useIdeaActions();
  const chip = (label: string, className: string) => <span className={cn("rounded px-1.5 text-[11px] font-medium", className)}>{label}</span>;
  return (
    <li className={cn("flex gap-3 border-b", compact ? "py-2" : "px-4 py-3")} data-testid={`plan-entry-${entry.kind}`}>
      <div className={cn("shrink-0 text-xs tabular-nums", compact ? "w-16" : "w-20 sm:w-24")}>
        <p className="font-semibold">{dayLabel(entry.date)}</p>
        <p className="text-muted-foreground">{entry.time ?? "Lead-up"}</p>
      </div>
      <div className="min-w-0 flex-1 text-sm">
        {entry.kind === "scheduled" && <>
          <p className="flex flex-wrap items-center gap-1.5">{chip("Scheduled", "bg-info-subtle text-info")}</p>
          <p className="mt-1 break-words font-medium">{entry.post.excerpt || "(No text)"}</p>
          <Link href={SCHEDULED_HREF} className="mt-1 inline-flex min-h-8 items-center text-xs font-semibold text-primary hover:underline">View in Scheduled</Link>
        </>}
        {entry.kind === "suggestion" && <>
          <p className="flex flex-wrap items-center gap-1.5">{chip("Suggested", "border")}{entry.idea.pillar && chip(entry.idea.pillar, "bg-primary/10 text-primary")}{entry.idea.state === "saved" && chip("Saved", "text-warning")}</p>
          <p className="mt-1 break-words font-medium">{entry.idea.title}</p>
          {!compact && <p className="mt-0.5 break-words text-xs text-muted-foreground">{entry.idea.angle}</p>}
          <Button size="sm" variant="outline" className="mt-2" onClick={() => actions.draft(entry.idea)} data-testid="button-plan-draft"><Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Draft this</Button>
        </>}
        {entry.kind === "open" && <>
          <p className="font-medium text-muted-foreground">Open slot</p>
          <p className="mt-0.5 text-xs text-muted-foreground">No idea left for this time. <Link href={STRATEGY_HREF} className="font-semibold text-primary hover:underline">Add pillars</Link> or check in to get more.</p>
        </>}
        {entry.kind === "moment" && <>
          <p className="flex flex-wrap items-center gap-1.5">{chip("Moment", "bg-warning-subtle text-warning")}<span className="text-xs text-muted-foreground">On {shortDate(entry.moment.date)}</span></p>
          <p className="mt-1 break-words font-medium"><Flag className="mr-1 inline h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />{entry.moment.title}</p>
          {!compact && <p className="mt-0.5 break-words text-xs text-muted-foreground">{entry.idea.angle}</p>}
          <Button size="sm" variant="outline" className="mt-2" onClick={() => actions.draft(entry.idea)}><Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Draft this</Button>
        </>}
      </div>
    </li>
  );
}

/** 30-day agenda grouped by week. Suggestions only: nothing here schedules or posts. */
export function PlanAgenda() {
  const { plan, entries } = usePlanEntries();
  const weeks = useMemo(() => groupPlanByWeek(entries), [entries]);
  return (
    <div className="h-full min-h-0 overflow-y-auto pb-24 lg:pb-0" data-testid="plan-agenda">
      <div className="border-b px-4 py-3 text-xs text-muted-foreground">
        <p><CalendarClock className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />Suggestions only. Nothing is scheduled or posted automatically.
          {plan.data && <> Times are in {plan.data.timezone}. {plan.data.postsPerWeek} {plan.data.postsPerWeek === 1 ? "post" : "posts"} a week.</>}</p>
        {plan.data && !plan.data.hasStrategy && <p className="mt-1">Using suggested posting days. <Link href={STRATEGY_HREF} className="font-semibold text-primary hover:underline">Set your own in Strategy</Link>.</p>}
      </div>
      {plan.isPending ? <div className="space-y-px p-4" aria-label="Loading plan">{[0, 1, 2].map(key => <Skeleton key={key} className="h-12 w-full" />)}</div>
        : plan.isError ? <div role="alert" className="p-6 text-sm"><p className="font-medium">Your plan could not be loaded.</p><Button variant="outline" className="mt-3" onClick={() => void plan.refetch()}>Try again</Button></div>
        : weeks.length ? weeks.map(week => <section key={week.weekStart} aria-labelledby={`week-${week.weekStart}`}>
            <h3 id={`week-${week.weekStart}`} className="sticky top-0 z-[1] border-b bg-card px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Week of {shortDate(week.weekStart)} – {shortDate(addDays(week.weekStart, 6))}
            </h3>
            <ul>{week.entries.map(entry => <PlanRow key={entry.key} entry={entry} />)}</ul>
          </section>)
        : <div className="px-6 py-14 text-center text-sm text-muted-foreground"><p className="font-medium text-foreground">Nothing planned</p><p className="mt-1">Set your posting days in <Link href={STRATEGY_HREF} className="font-semibold text-primary hover:underline">Strategy</Link>.</p></div>}
    </div>
  );
}
