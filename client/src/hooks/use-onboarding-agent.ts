import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiRequest } from "@/lib/queryClient";
import {
  parseAgentEvent, parseOnboardingSuggestions, readEventStream,
  type SuggestedChoice, type SuggestionResult, type SuggestionStep, type Understanding,
} from "@/lib/onboarding-suggestions";
import type { SearchEditionId } from "@shared/search-editions";

export const SUGGESTION_REFRESH_DELAY_MS = 1200;
export const MAX_SUGGESTION_REFRESHES = 3;
const AGENT_TIMEOUT_MS = 90_000;
const REFRESH_TIMEOUT_MS = 25_000;
const FEED_LINES = 12;
const STEPS: SuggestionStep[] = ["publications", "topics", "people"];

export interface SuggestionBatch { id: number; items: SuggestedChoice[] }
export interface AgentStepState {
  status: "idle" | "running" | "ready" | "error";
  /** The agent's latest result for this step. */
  items: SuggestedChoice[];
  note: string;
  grounded: boolean;
  /** Progress lines from the agent's latest run of this step. */
  feed: string[];
  /** "More like your picks" additions. */
  batches: SuggestionBatch[];
  refreshes: number;
  refreshing: boolean;
  error?: string;
}
export interface AgentContext {
  focusDescription: string;
  industry?: string;
  searchEdition: SearchEditionId;
  understanding?: Omit<Understanding, "question">;
  /** Picked publications with any known website, read when a request starts. */
  publications: () => Array<{ name: string; url?: string }>;
  topics: string[];
  /** Current selections and removals per step. */
  picks: Record<SuggestionStep, string[]>;
  removed: Record<SuggestionStep, string[]>;
}
export type ResultMode = "build" | "steer";
type State = Record<SuggestionStep, AgentStepState>;

const idle = (): AgentStepState => ({ status: "idle", items: [], note: "", grounded: true, feed: [], batches: [], refreshes: 0, refreshing: false });
const initialState = (): State => ({ publications: idle(), topics: idle(), people: idle() });
const key = (value: string) => value.trim().toLowerCase();
const unique = (values: string[]) => [...new Map(values.map(value => [key(value), value])).values()];

function failureMessage(code: string | undefined, timedOut = false) {
  if (timedOut || code === "ai_timeout") return "The agent took too long.";
  if (code === "rate_limited" || code === "ai_budget") return "You've asked the agent a lot in the last hour. Try again in a few minutes.";
  return "The agent couldn't finish this step.";
}

/** Settle on abort even if the response never finishes. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * The onboarding agent on the client. `run` streams an agent run for one or more steps: progress
 * lines, then each step's result, whose picks the wizard pre-selects through `onResult`. A newer
 * run takes over the steps it covers; results from older runs for those steps are ignored.
 * Picking something new also adds "more like your picks" options (at most three times a step).
 */
export function useOnboardingAgent(step: SuggestionStep | undefined, enabled: boolean, context: AgentContext,
  onResult: (step: SuggestionStep, result: SuggestionResult, mode: ResultMode) => void) {
  const [state, setState] = useState<State>(initialState);
  const [catalog, setCatalog] = useState<SuggestedChoice[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const contextRef = useRef(context);
  contextRef.current = context;
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const runs = useRef(new Map<number, AbortController>());
  const owner = useRef<Partial<Record<SuggestionStep, number>>>({});
  const runId = useRef(0);
  const batchId = useRef(0);
  const refreshControllers = useRef(new Set<AbortController>());
  // Picks the latest research already reflects; only a new pick triggers "more like your picks".
  const requestedPicks = useRef(new Map<SuggestionStep, string[]>());

  const update = useCallback((target: SuggestionStep, change: (current: AgentStepState) => Partial<AgentStepState>) => {
    setState(previous => ({ ...previous, [target]: { ...previous[target], ...change(previous[target]) } }));
  }, []);

  const base = useCallback(() => {
    const current = contextRef.current;
    return {
      focusDescription: current.focusDescription.trim(),
      ...(current.industry ? { industry: current.industry } : {}),
      searchEdition: current.searchEdition,
      ...(current.understanding ? { understanding: current.understanding } : {}),
      publications: current.publications().slice(0, 20),
      topics: current.topics.slice(0, 20),
    };
  }, []);

  const remember = useCallback((items: SuggestedChoice[]) => {
    setCatalog(previous => {
      const known = new Set(previous.map(item => `${item.kind}:${key(item.name)}`));
      return [...previous, ...items.filter(item => !known.has(`${item.kind}:${key(item.name)}`))];
    });
  }, []);

  const applyResult = useCallback((target: SuggestionStep, result: SuggestionResult, mode: ResultMode) => {
    const removed = new Set(contextRef.current.removed[target].map(key));
    const items = result.items.filter(item => !removed.has(key(item.name)));
    const picks = result.picks.filter(pick => !removed.has(key(pick)));
    remember(items);
    update(target, current => ({ status: "ready", items, note: result.note, grounded: result.grounded, error: undefined, batches: mode === "steer" ? [] : current.batches }));
    requestedPicks.current.set(target, unique([...contextRef.current.picks[target], ...picks]));
    onResultRef.current(target, { ...result, items, picks }, mode);
  }, [remember, update]);

  const run = useCallback(async (steps: SuggestionStep[], instruction?: string) => {
    const id = ++runId.current;
    for (const target of steps) owner.current[target] = id;
    // An older run that no longer owns any step has nothing left to do.
    for (const [older, controller] of runs.current) {
      if (!Object.values(owner.current).includes(older)) { controller.abort(); runs.current.delete(older); }
    }
    const controller = new AbortController();
    runs.current.set(id, controller);
    const owns = (target: SuggestionStep) => owner.current[target] === id;
    const pending = new Set(steps);
    const mode: ResultMode = instruction ? "steer" : "build";
    for (const target of steps) update(target, () => ({ status: "running", feed: [], error: undefined }));
    const fail = (target: SuggestionStep, message: string) => { if (owns(target)) update(target, () => ({ status: "error", error: message })); };
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, AGENT_TIMEOUT_MS);
    const current = contextRef.current;
    const exclude = unique(steps.flatMap(target => current.removed[target])).slice(0, 200);
    try {
      await untilAborted((async () => {
        const response = await apiRequest("POST", "/api/onboarding/agent", { ...base(), exclude, ...(instruction ? { instruction } : {}), steps }, { signal: controller.signal });
        await readEventStream(response, raw => {
          if (controller.signal.aborted) return;
          const event = parseAgentEvent(raw);
          if (!event) return;
          if (event.type === "progress" && owns(event.step)) update(event.step, state => ({ feed: [...state.feed, event.message].slice(-FEED_LINES) }));
          if (event.type === "result" && pending.has(event.step)) {
            pending.delete(event.step);
            if (owns(event.step)) applyResult(event.step, event.result, mode);
          }
          if (event.type === "error") {
            for (const target of event.step ? [event.step] : [...pending]) { pending.delete(target); fail(target, failureMessage(event.code)); }
          }
        });
      })(), controller.signal);
      for (const target of pending) fail(target, "The agent stopped before finishing this step.");
    } catch (error) {
      if (controller.signal.aborted && !timedOut) return;
      const code = error instanceof ApiError && error.status === 429 ? "rate_limited" : undefined;
      for (const target of pending) fail(target, failureMessage(code, timedOut));
    } finally {
      clearTimeout(timer);
      runs.current.delete(id);
    }
  }, [applyResult, base, update]);

  const refresh = useCallback(async (target: SuggestionStep) => {
    const current = contextRef.current;
    const stepState = stateRef.current[target];
    requestedPicks.current.set(target, current.picks[target]);
    const shown = [...stepState.items, ...stepState.batches.flatMap(batch => batch.items)].map(item => item.name);
    const controller = new AbortController();
    refreshControllers.current.add(controller);
    const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
    update(target, () => ({ refreshing: true }));
    try {
      const result = await untilAborted((async () => {
        const response = await apiRequest("POST", "/api/onboarding/suggestions", {
          ...base(), step: target, exclude: unique([...shown, ...current.picks[target], ...current.removed[target]]).slice(0, 200),
        }, { signal: controller.signal });
        return parseOnboardingSuggestions(target, await response.json());
      })(), controller.signal);
      remember(result.items);
      update(target, latest => {
        const hidden = new Set([...latest.items, ...latest.batches.flatMap(batch => batch.items)].map(item => key(item.name)));
        for (const name of [...contextRef.current.picks[target], ...contextRef.current.removed[target]]) hidden.add(key(name));
        const fresh = result.items.filter(item => !hidden.has(key(item.name)));
        return { refreshing: false, refreshes: latest.refreshes + 1, batches: fresh.length ? [...latest.batches, { id: ++batchId.current, items: fresh }] : latest.batches };
      });
    } catch {
      // "More like your picks" is a bonus; a failure just leaves what is shown.
      update(target, () => ({ refreshing: false }));
    } finally {
      clearTimeout(timer);
      refreshControllers.current.delete(controller);
    }
  }, [base, remember, update]);

  const abortAll = useCallback(() => {
    for (const controller of runs.current.values()) controller.abort();
    runs.current.clear();
    for (const controller of refreshControllers.current) controller.abort();
    refreshControllers.current.clear();
    owner.current = {};
  }, []);

  /** Stop the agent; steps keep what they already found. */
  const cancel = useCallback(() => {
    abortAll();
    setState(previous => {
      if (!STEPS.some(target => previous[target].status === "running" || previous[target].refreshing)) return previous;
      const next = { ...previous };
      for (const target of STEPS) {
        const current = next[target];
        if (current.status === "running" || current.refreshing) next[target] = { ...current, refreshing: false, status: current.status === "running" ? (current.items.length ? "ready" : "idle") : current.status };
      }
      return next;
    });
  }, [abortAll]);

  /** Start over (the focus changed). The catalog keeps earlier URLs and weights. */
  const reset = useCallback(() => {
    abortAll();
    requestedPicks.current.clear();
    stateRef.current = initialState();
    setState(stateRef.current);
  }, [abortAll]);

  const retry = useCallback((target: SuggestionStep) => { void run([target]); }, [run]);

  useEffect(() => abortAll, [abortAll]);
  useEffect(() => { if (!enabled) cancel(); }, [enabled, cancel]);

  const status = step ? state[step].status : undefined;
  const refreshes = step ? state[step].refreshes : 0;
  const refreshing = step ? state[step].refreshing : false;
  const picksKey = step ? context.picks[step].map(key).join("\n") : "";
  useEffect(() => {
    if (!enabled || !step || status !== "ready" || refreshing || refreshes >= MAX_SUGGESTION_REFRESHES) return;
    const requested = new Set((requestedPicks.current.get(step) ?? []).map(key));
    if (!picksKey.split("\n").some(pick => pick && !requested.has(pick))) return;
    const timer = setTimeout(() => { void refresh(step); }, SUGGESTION_REFRESH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled, step, status, refreshing, refreshes, picksKey, refresh]);

  return { state, catalog, run, retry, cancel, reset };
}
