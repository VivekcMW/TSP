import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, ExternalLink, Lightbulb, Pencil, Star, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useInboxShell } from "@/components/inbox/inbox-shell";
import { CheckinCard } from "@/components/inbox/ideas/checkin-card";
import { useIdeaActions } from "@/components/inbox/ideas/use-idea-actions";
import { useIsSignedIn } from "@/lib/dev-auth";
import { ignoreInboxShortcut } from "@/lib/inbox-shortcuts";
import { ideasQuery, strategyQuery, useMoments } from "@/lib/strategy-queries";
import { cn } from "@/lib/utils";
import { IDEA_KIND_LABELS, mergeMomentIdeas, momentIdeas, shortDate, type RankedIdea } from "@shared/topic-ideas";

export const ideasHref = (view: "ideas" | "plan" | "strategy") => view === "ideas" ? "/dashboard?folder=ideas" : `/dashboard?folder=ideas&view=${view}`;
const matches = (idea: RankedIdea, needle: string) => !needle || [idea.title, idea.angle, idea.pillar ?? "", idea.why].some(text => text.toLocaleLowerCase().includes(needle));

export function IdeaChips({ idea }: Readonly<{ idea: RankedIdea }>) {
  return <>
    <span className="rounded border px-1.5 text-[11px] font-medium">{IDEA_KIND_LABELS[idea.kind]}</span>
    {idea.pillar && <span className="rounded bg-primary/10 px-1.5 text-[11px] font-medium text-primary">{idea.pillar}</span>}
    {idea.state === "saved" && <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-warning"><Star className="h-3 w-3 fill-current" aria-hidden="true" />Saved</span>}
    {idea.state === "used" && <span className="text-[11px] font-medium text-muted-foreground">Drafted</span>}
  </>;
}

/** Ideas list + reading pane, like the post folders. j/k move, o opens, u goes back, r drafts, s saves, e hides. */
export function IdeasList() {
  const signedIn = Boolean(useIsSignedIn());
  const { query } = useInboxShell();
  const actions = useIdeaActions();
  const moments = useMoments(signedIn);
  const ideas = useQuery(ideasQuery(moments.extra, signedIn && moments.ready));
  const strategy = useQuery(strategyQuery(signedIn));
  const plan = strategy.data?.strategy ?? strategy.data?.suggested;
  const needle = query.trim().toLocaleLowerCase();
  const list = useMemo(() => {
    if (!ideas.data) return [];
    const merged = plan ? mergeMomentIdeas(ideas.data, momentIdeas(moments.moments, plan, moments.today)) : ideas.data.ideas;
    return merged.filter(idea => matches(idea, needle));
  }, [ideas.data, moments.moments, moments.today, plan, needle]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [readingOpen, setReadingOpen] = useState(false);
  const lastIndex = useRef(0);
  const index = list.findIndex(idea => idea.id === selectedId);
  if (index >= 0) lastIndex.current = index;
  const selected = index >= 0 ? list[index] : null;
  useEffect(() => {
    if (!selected && list.length) setSelectedId(list[Math.min(lastIndex.current, list.length - 1)].id);
  }, [selected, list]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (ignoreInboxShortcut(event) || !["j", "k", "o", "u", "r", "s", "e"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "u") { setReadingOpen(false); return; }
      if (!selected) return;
      if (event.key === "o") { setReadingOpen(true); return; }
      if (event.key === "r") { actions.draft(selected); return; }
      if (event.key === "s") { void actions.toggleSave(selected); return; }
      if (event.key === "e") { void actions.dismiss(selected, index); return; }
      const next = list[Math.max(0, Math.min(list.length - 1, index + (event.key === "j" ? 1 : -1)))];
      if (!next) return;
      setSelectedId(next.id);
      setReadingOpen(true);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="row-idea-${CSS.escape(next.id)}"]`)?.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list, index, selected, actions]);

  const hasStrategy = ideas.data?.hasStrategy ?? strategy.data?.saved ?? true;
  return (
    <div className="flex h-full min-h-0">
      <section aria-label="Ideas list" data-inbox-list className={cn("min-h-0 min-w-0 flex-col border-r lg:flex lg:w-[min(46%,36rem)] lg:shrink-0", readingOpen ? "hidden" : "flex w-full")}>
        <div className="min-h-0 flex-1 overflow-y-auto pb-24 lg:pb-0">
          <CheckinCard />
          {ideas.isSuccess && !hasStrategy && list.length > 0 && <p className="mx-3 mb-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground" data-testid="banner-suggested-strategy">
            These ideas use suggestions from your profile. <Link href={ideasHref("strategy")} className="font-semibold text-primary hover:underline">Review your strategy</Link> to make them yours.
          </p>}
          {ideas.isPending ? <div className="space-y-px" aria-label="Loading ideas">{[0, 1, 2].map(key => <div key={key} className="space-y-2 border-b p-4"><Skeleton className="h-3 w-1/4" /><Skeleton className="h-4 w-4/5" /></div>)}</div>
            : ideas.isError ? <div role="alert" className="p-6 text-sm"><p className="font-medium">Ideas could not be loaded.</p><Button variant="outline" className="mt-3" onClick={() => void ideas.refetch()}>Try again</Button></div>
            : list.length ? <ul aria-label="Topic ideas">{list.map(idea => {
                const isSelected = idea.id === selected?.id;
                return <li key={idea.id} className={cn("border-b", isSelected && "bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]")}>
                  <button type="button" onClick={() => { setSelectedId(idea.id); setReadingOpen(true); }} aria-current={isSelected ? "true" : undefined}
                    className="block w-full px-4 py-2.5 text-left hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" data-testid={`row-idea-${idea.id}`}>
                    <span className="flex flex-wrap items-center gap-1.5 text-muted-foreground"><IdeaChips idea={idea} /></span>
                    <span className={cn("mt-1 block truncate text-sm", idea.state === "used" ? "text-muted-foreground" : "font-semibold")}>{idea.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{idea.angle}</span>
                  </button>
                </li>;
              })}</ul>
            : <div className="flex flex-col items-center px-6 py-14 text-center" data-testid="ideas-empty">
                <Lightbulb className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <h3 className="mt-3 text-base font-semibold">{needle ? "No matching ideas" : hasStrategy ? "No ideas right now" : "Set up your strategy"}</h3>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">{needle ? "Try another search."
                  : hasStrategy ? "Add pillars to your strategy, or answer this week's check-in, to get more ideas."
                  : "Tell us who you write for and the topics you know. Ideas follow from that."}</p>
                {!needle && <Button asChild variant="outline" className="mt-4"><Link href={ideasHref("strategy")}>Open Strategy</Link></Button>}
              </div>}
        </div>
      </section>
      <section aria-label="Reading pane" className={cn("min-h-0 min-w-0 flex-1 flex-col lg:flex", readingOpen ? "flex" : "hidden")}>
        {selected ? <IdeaPane key={selected.id} idea={selected} index={index} onBack={() => setReadingOpen(false)} />
          : <div className="m-auto max-w-sm px-6 text-center text-sm text-muted-foreground"><p className="font-medium text-foreground">Ideas</p><p className="mt-1">Pick an idea to see why it fits you.</p></div>}
      </section>
    </div>
  );
}

function IdeaPane({ idea, index, onBack }: Readonly<{ idea: RankedIdea; index: number; onBack: () => void }>) {
  const actions = useIdeaActions();
  return <>
    <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2" aria-label="Idea actions">
      <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Back to list" onClick={onBack}><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Button>
      <Button variant="ghost" size="icon" aria-label={idea.state === "saved" ? "Remove from saved" : "Save idea"} title={idea.state === "saved" ? "Remove from saved" : "Save idea"} aria-pressed={idea.state === "saved"}
        onClick={() => void actions.toggleSave(idea)}><Star className={cn("h-4 w-4", idea.state === "saved" && "fill-current text-warning")} aria-hidden="true" /></Button>
      <Button variant="ghost" size="icon" aria-label="Not for me" title="Not for me" onClick={() => void actions.dismiss(idea, index)}><ThumbsDown className="h-4 w-4" aria-hidden="true" /></Button>
    </div>
    <article className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7" aria-labelledby="idea-title">
      <p className="flex flex-wrap items-center gap-2 text-muted-foreground"><IdeaChips idea={idea} /></p>
      <h2 id="idea-title" className="mt-3 break-words text-xl font-semibold leading-snug" data-testid="text-idea-title">{idea.title}</h2>
      <p className="mt-3 break-words text-sm leading-relaxed" data-testid="text-idea-angle">{idea.angle}</p>
      <section className="mt-5 rounded-md border bg-muted/30 p-3" aria-label="Why this idea">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Why this idea</h3>
        <p className="mt-1 break-words text-sm" data-testid="text-idea-why">{idea.why}</p>
      </section>
      {idea.momentDate && <p className="mt-3 flex items-center gap-1.5 text-sm"><CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />On {shortDate(idea.momentDate)}</p>}
      {idea.sourceStory && <a href={idea.sourceStory.url} target="_blank" rel="noopener noreferrer" className="mt-3 flex items-start gap-2 rounded-md border p-3 text-sm hover:bg-muted/50" data-testid="link-idea-story">
        <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0"><span className="block break-words font-medium">{idea.sourceStory.headline}</span><span className="text-xs text-muted-foreground">{idea.sourceStory.source}</span></span>
      </a>}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={() => actions.draft(idea)} data-testid="button-draft-idea"><Pencil className="mr-2 h-4 w-4" aria-hidden="true" />Draft this</Button>
        <Button variant="outline" onClick={() => void actions.toggleSave(idea)} aria-pressed={idea.state === "saved"} data-testid="button-save-idea">
          <Star className={cn("mr-2 h-4 w-4", idea.state === "saved" && "fill-current text-warning")} aria-hidden="true" />{idea.state === "saved" ? "Saved" : "Save"}
        </Button>
        <Button variant="ghost" onClick={() => void actions.dismiss(idea, index)} data-testid="button-dismiss-idea"><ThumbsDown className="mr-2 h-4 w-4" aria-hidden="true" />Not for me</Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Draft this opens the composer. Nothing is posted until you press Post.</p>
    </article>
  </>;
}
