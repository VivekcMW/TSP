import { Link, useSearch } from "wouter";
import { IdeasList, ideasHref } from "@/components/inbox/ideas/ideas-list";
import { PlanAgenda } from "@/components/inbox/ideas/plan-agenda";
import { StrategyEditor } from "@/components/inbox/ideas/strategy-editor";
import { cn } from "@/lib/utils";

const VIEWS = [
  { id: "ideas", label: "Ideas" },
  { id: "plan", label: "30-day plan" },
  { id: "strategy", label: "Strategy" },
] as const;
type IdeasViewId = typeof VIEWS[number]["id"];
const parseView = (search: string): IdeasViewId => VIEWS.find(view => view.id === new URLSearchParams(search).get("view"))?.id ?? "ideas";

/** Topic discovery (/dashboard?folder=ideas&view=ideas|plan|strategy): what to post next, when, and why. */
export function IdeasView() {
  const view = parseView(useSearch());
  const title = VIEWS.find(entry => entry.id === view)!.label;
  return (
    <main className="flex h-full min-h-0 flex-col" aria-label={view === "ideas" ? "Ideas" : `Ideas: ${title}`}>
      <nav aria-label="Ideas views" className="flex h-12 shrink-0 items-end gap-1 overflow-x-auto border-b px-2 sm:px-4">
        {VIEWS.map(entry => <Link key={entry.id} href={ideasHref(entry.id)} aria-current={entry.id === view ? "page" : undefined} data-testid={`tab-ideas-${entry.id}`}
          className={cn("inline-flex h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
            entry.id === view ? "border-primary text-primary" : "border-transparent text-muted-foreground")}>{entry.label}</Link>)}
      </nav>
      <div className="min-h-0 flex-1">
        {view === "ideas" ? <IdeasList /> : view === "plan" ? <PlanAgenda /> : <StrategyEditor />}
      </div>
    </main>
  );
}
