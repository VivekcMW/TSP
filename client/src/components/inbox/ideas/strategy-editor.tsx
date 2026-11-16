import { useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { useToast } from "@/hooks/use-toast";
import { useIsSignedIn } from "@/lib/dev-auth";
import { queryClient } from "@/lib/queryClient";
import { refreshTopicQueries, saveStrategy, STRATEGY_KEY, StrategyConflict, strategyQuery } from "@/lib/strategy-queries";
import {
  contentStrategySchema, EXPERTISE_LABELS, GOAL_LABELS, MAX_PILLARS, MAX_SLOTS, STRATEGY_GOALS, WEEKDAY_NAMES,
  type ContentPillar, type ContentStrategy, type Expertise, type PostingSlot, type StrategyResponse,
} from "@shared/topic-ideas";

const field = "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const EXPERTISE: Expertise[] = [1, 2, 3];
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];
const message = (error: unknown) => error instanceof Error && error.message ? error.message : "Try again.";
const same = (a: ContentStrategy, b: ContentStrategy) => JSON.stringify(a) === JSON.stringify(b);

/** Pillars carry a client-only key so reordering keeps each row's DOM, state and focus with its pillar. */
type EditablePillar = ContentPillar & { key: string };
type FormState = Omit<ContentStrategy, "pillars"> & { pillars: EditablePillar[] };
let pillarKeys = 0;
const newPillar = (pillar: ContentPillar): EditablePillar => ({ ...pillar, key: `pillar-${++pillarKeys}` });
const toForm = (strategy: ContentStrategy): FormState => ({ ...strategy, pillars: strategy.pillars.map(newPillar) });
const fromForm = (form: FormState): ContentStrategy => ({ ...form, pillars: form.pillars.map(({ key: _key, ...pillar }) => pillar) });

/** Audience, goal, up to five pillars and the posting cadence. Suggestions from the profile are never saved until Save. */
export function StrategyEditor() {
  const signedIn = Boolean(useIsSignedIn());
  const strategy = useQuery(strategyQuery(signedIn));
  if (strategy.isLoading) return <div className="space-y-3 p-6" aria-label="Loading strategy">{[0, 1, 2].map(key => <Skeleton key={key} className="h-16 w-full max-w-2xl" />)}</div>;
  if (!strategy.data) return <div role="alert" className="p-6 text-sm"><p className="font-medium">Your strategy could not be loaded.</p><Button variant="outline" className="mt-3" onClick={() => void strategy.refetch()}>Try again</Button></div>;
  return <StrategyForm initial={strategy.data} />;
}

function StrategyForm({ initial }: Readonly<{ initial: StrategyResponse }>) {
  const id = useId();
  const { toast } = useToast();
  const [response, setResponse] = useState(initial);
  const [form, setForm] = useState<FormState>(() => toForm(initial.strategy ?? initial.suggested));
  const [announcement, setAnnouncement] = useState("");
  const moveButtons = useRef(new Map<string, { up?: HTMLButtonElement | null; down?: HTMLButtonElement | null }>());
  const moveButton = (key: string, direction: "up" | "down") => (element: HTMLButtonElement | null) => {
    moveButtons.current.set(key, { ...moveButtons.current.get(key), [direction]: element });
  };
  const [conflict, setConflict] = useState<StrategyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const baseline = response.strategy ?? response.suggested;
  const dirty = !response.saved || !same(fromForm(form), baseline);
  const set = (change: Partial<FormState>) => { setForm(current => ({ ...current, ...change })); setError(null); };
  const setPillar = (index: number, change: Partial<ContentPillar>) => set({ pillars: form.pillars.map((pillar, at) => at === index ? { ...pillar, ...change } : pillar) });
  const movePillar = (index: number, by: -1 | 1) => {
    const pillars = [...form.pillars];
    const moved = pillars[index];
    [pillars[index], pillars[index + by]] = [pillars[index + by], pillars[index]];
    set({ pillars });
    setAnnouncement(`Moved ${moved.name.trim() || "pillar"} to position ${index + by + 1} of ${pillars.length}.`);
    // Keep focus on the pillar that moved: the same button, or the other one once it reaches the top or bottom.
    requestAnimationFrame(() => {
      const buttons = moveButtons.current.get(moved.key);
      const [toward, back] = by < 0 ? [buttons?.up, buttons?.down] : [buttons?.down, buttons?.up];
      (toward && !toward.disabled ? toward : back)?.focus();
    });
  };
  const setSlot = (index: number, change: Partial<PostingSlot>) => set({ cadence: { ...form.cadence, slots: form.cadence.slots.map((slot, at) => at === index ? { ...slot, ...change } : slot) } });

  const save = async (revision = response.revision) => {
    const parsed = contentStrategySchema.safeParse(fromForm(form));
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check your strategy."); return; }
    setSaving(true);
    try {
      const result = await saveStrategy(revision, parsed.data);
      queryClient.setQueryData(STRATEGY_KEY, result);
      setResponse(result);
      setForm(toForm(result.strategy ?? parsed.data));
      setConflict(null);
      toast({ title: "Strategy saved", description: "Your ideas and plan now follow it." });
      void refreshTopicQueries();
    } catch (failure) {
      if (failure instanceof StrategyConflict) { setConflict(failure.current); queryClient.setQueryData(STRATEGY_KEY, failure.current); }
      else toast({ title: "Couldn't save your strategy", description: message(failure), variant: "destructive" });
    } finally { setSaving(false); }
  };
  const loadLatest = () => {
    if (!conflict) return;
    setResponse(conflict);
    setForm(toForm(conflict.strategy ?? conflict.suggested));
    setConflict(null);
  };

  return (
    <form className="flex h-full min-h-0 flex-col" aria-label="Content strategy" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-6 px-4 py-5 sm:px-6">
          {!response.saved && <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm" data-testid="banner-strategy-suggested">
            <span className="mr-2 rounded bg-primary/10 px-1.5 text-[11px] font-semibold uppercase text-primary">Suggested</span>
            These are suggestions from your profile. Nothing is saved until you press Save.
          </p>}
          {conflict && <div role="alert" className="rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-sm" data-testid="alert-strategy-conflict">
            <p className="font-medium">This strategy was changed in another tab or device.</p>
            <p className="mt-1 text-muted-foreground">Load the latest version, or save yours over it.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={loadLatest}>Load latest</Button>
              <Button type="button" size="sm" onClick={() => void save(conflict.revision)} disabled={saving}>Save mine anyway</Button>
            </div>
          </div>}

          <section aria-labelledby={`${id}-audience`} className="space-y-2">
            <h3 id={`${id}-audience`} className="text-sm font-semibold">Audience</h3>
            <label htmlFor={`${id}-audience-input`} className="block text-xs text-muted-foreground">Who do you want to reach on LinkedIn?</label>
            <textarea id={`${id}-audience-input`} value={form.audience} maxLength={200} rows={2} placeholder="For example: founders of D2C brands in India"
              onChange={event => set({ audience: event.target.value })} className={`${field} resize-none`} data-testid="input-strategy-audience" />
          </section>

          <section aria-labelledby={`${id}-goal`} className="space-y-2">
            <h3 id={`${id}-goal`} className="text-sm font-semibold">Goal</h3>
            <SegmentedControl aria-labelledby={`${id}-goal`}>
              {STRATEGY_GOALS.map(goal => <SegmentedControlItem key={goal} selected={form.goal === goal} onClick={() => set({ goal })}>{GOAL_LABELS[goal]}</SegmentedControlItem>)}
            </SegmentedControl>
            <label htmlFor={`${id}-goal-note`} className="block text-xs text-muted-foreground">Note (optional)</label>
            <input id={`${id}-goal-note`} value={form.goalNote} maxLength={120} onChange={event => set({ goalNote: event.target.value })} className={field} placeholder="For example: two new clients this quarter" />
          </section>

          <section aria-labelledby={`${id}-pillars`} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id={`${id}-pillars`} className="text-sm font-semibold">Pillars <span className="font-normal text-muted-foreground">({form.pillars.length}/{MAX_PILLARS})</span></h3>
              <p className="text-xs text-muted-foreground">The topics you post about, in order of importance.</p>
            </div>
            {form.pillars.length === 0 && <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">No pillars yet. Add the topics you know best.</p>}
            <p className="sr-only" aria-live="polite" data-testid="text-pillar-announcement">{announcement}</p>
            <ol className="space-y-3">{form.pillars.map((pillar, index) => <li key={pillar.key} className="rounded-md border p-3" data-testid={`pillar-${index}`}>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1 basis-48">
                  <label htmlFor={`${id}-pillar-${index}`} className="text-xs font-medium">Pillar {index + 1}</label>
                  <input id={`${id}-pillar-${index}`} value={pillar.name} maxLength={60} onChange={event => setPillar(index, { name: event.target.value })} className={`${field} mt-1`} data-testid={`input-pillar-name-${index}`} />
                </div>
                <div className="flex">
                  <Button type="button" variant="ghost" size="icon" aria-label={`Move ${pillar.name || `pillar ${index + 1}`} up`} disabled={index === 0} onClick={() => movePillar(index, -1)} ref={moveButton(pillar.key, "up")}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Move ${pillar.name || `pillar ${index + 1}`} down`} disabled={index === form.pillars.length - 1} onClick={() => movePillar(index, 1)} ref={moveButton(pillar.key, "down")}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${pillar.name || `pillar ${index + 1}`}`} onClick={() => set({ pillars: form.pillars.filter((_, at) => at !== index) })}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                </div>
              </div>
              <p id={`${id}-expertise-${index}`} className="mt-3 text-xs font-medium">Your expertise</p>
              <SegmentedControl aria-labelledby={`${id}-expertise-${index}`} className="mt-1">
                {EXPERTISE.map(level => <SegmentedControlItem key={level} selected={pillar.expertise === level} onClick={() => setPillar(index, { expertise: level })}>{EXPERTISE_LABELS[level]}</SegmentedControlItem>)}
              </SegmentedControl>
              <label htmlFor={`${id}-proof-${index}`} className="mt-3 block text-xs font-medium">A story or result you can share <span className="font-normal text-muted-foreground">(optional)</span></label>
              <textarea id={`${id}-proof-${index}`} value={pillar.proof} maxLength={200} rows={2} onChange={event => setPillar(index, { proof: event.target.value })} className={`${field} mt-1 resize-none`}
                placeholder="For example: cut cost per order by 30% for a beauty brand" />
            </li>)}</ol>
            <Button type="button" variant="outline" size="sm" disabled={form.pillars.length >= MAX_PILLARS} data-testid="button-add-pillar"
              onClick={() => set({ pillars: [...form.pillars, newPillar({ name: "", expertise: 2, proof: "" })] })}><Plus className="mr-1 h-4 w-4" aria-hidden="true" />Add pillar</Button>
          </section>

          <section aria-labelledby={`${id}-cadence`} className="space-y-3">
            <h3 id={`${id}-cadence`} className="text-sm font-semibold">Cadence</h3>
            <p id={`${id}-per-week`} className="text-xs font-medium">Posts per week</p>
            <SegmentedControl aria-labelledby={`${id}-per-week`}>
              {[1, 2, 3, 4, 5, 6, 7].map(count => <SegmentedControlItem key={count} selected={form.cadence.postsPerWeek === count} onClick={() => set({ cadence: { ...form.cadence, postsPerWeek: count } })}>{count}</SegmentedControlItem>)}
            </SegmentedControl>
            <p className="text-xs text-muted-foreground">Posting times are in {response.timezone}. With fewer times than posts, we fill in usual weekdays at your preferred time.</p>
            <ul className="space-y-2">{form.cadence.slots.map((slot, index) => <li key={index} className="flex flex-wrap items-center gap-2" data-testid={`slot-${index}`}>
              <label className="sr-only" htmlFor={`${id}-slot-day-${index}`}>Day for posting time {index + 1}</label>
              <select id={`${id}-slot-day-${index}`} value={slot.weekday} onChange={event => setSlot(index, { weekday: Number(event.target.value) })} className={`${field} w-auto`}>
                {MONDAY_FIRST.map(day => <option key={day} value={day}>{WEEKDAY_NAMES[day]}</option>)}
              </select>
              <label className="sr-only" htmlFor={`${id}-slot-time-${index}`}>Time for posting time {index + 1}</label>
              <input id={`${id}-slot-time-${index}`} type="time" value={slot.time} onChange={event => setSlot(index, { time: event.target.value.slice(0, 5) })} className={`${field} w-auto`} />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove posting time ${index + 1}`} onClick={() => set({ cadence: { ...form.cadence, slots: form.cadence.slots.filter((_, at) => at !== index) } })}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
            </li>)}</ul>
            <Button type="button" variant="outline" size="sm" disabled={form.cadence.slots.length >= MAX_SLOTS}
              onClick={() => set({ cadence: { ...form.cadence, slots: [...form.cadence.slots, { weekday: 2, time: form.cadence.slots.at(-1)?.time ?? "09:00" }] } })}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />Add posting time
            </Button>
          </section>
        </div>
      </div>
      {/* Below lg, the shell's floating Compose button sits at the bottom right: keep the actions clear of it. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t py-3 pl-4 pr-40 lg:justify-end lg:pr-4">
        {error && <p role="alert" className="mr-auto text-sm text-destructive" data-testid="text-strategy-error">{error}</p>}
        {!error && response.saved && !dirty && <p className="mr-auto text-xs text-muted-foreground">All changes saved.</p>}
        {response.saved && <Button type="button" variant="ghost" onClick={() => { setForm(toForm(response.suggested)); setError(null); }}>Use profile suggestions</Button>}
        <Button type="submit" disabled={saving || !dirty} data-testid="button-save-strategy">{saving ? "Saving…" : response.saved ? "Save" : "Save strategy"}</Button>
      </div>
    </form>
  );
}
