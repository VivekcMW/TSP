import { useMemo } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useComposer } from "@/components/inbox/composer";
import { UpcomingMoments } from "@/components/inbox/moments-list";
import { PlanRow, usePlanEntries } from "@/components/inbox/ideas/plan-agenda";
import { addDays } from "@shared/topic-ideas";

/** Side-panel view of the plan: the next 7 days, upcoming moments and the Calendar. Suggestions only. */
export function PlanPanel() {
  const composer = useComposer();
  const { plan, entries } = usePlanEntries();
  const week = useMemo(() => plan.data ? entries.filter(entry => entry.kind !== "moment" && entry.date < addDays(plan.data.from, 7)) : [], [plan.data, entries]);
  return <>
    <section aria-labelledby="plan-panel-week" className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="plan-panel-week" className="font-semibold">Next 7 days</h3>
        <Link href="/dashboard?folder=ideas&view=plan" className="text-xs font-semibold text-primary hover:underline">Full plan</Link>
      </div>
      {plan.isPending ? <p className="text-xs text-muted-foreground">Loading your plan…</p>
        : plan.isError ? <p role="alert" className="text-xs text-muted-foreground">Your plan could not be loaded.</p>
        : week.length ? <ul aria-label="Next 7 days" data-testid="plan-panel-week">{week.map(entry => <PlanRow key={entry.key} entry={entry} compact />)}</ul>
        : <p className="text-xs text-muted-foreground">Nothing planned this week. Set your posting days in <Link href="/dashboard?folder=ideas&view=strategy" className="font-semibold text-primary hover:underline">Strategy</Link>.</p>}
      <p className="text-[11px] text-muted-foreground">Suggestions only. Nothing posts automatically.</p>
    </section>
    <UpcomingMoments days={30} limit={3} onDraft={angle => composer.openBlank(angle)} />
    <Button asChild variant="outline" className="w-full"><Link href="/dashboard/calendar">Open Calendar</Link></Button>
  </>;
}
