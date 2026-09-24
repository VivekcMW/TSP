import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { parseOnboardingSuggestions, type SuggestedChoice, type SuggestionResult, type SuggestionStep } from "@/lib/onboarding-suggestions";
import { selectedPublicationCandidates } from "@shared/publication-preferences";
import type { SearchEditionId } from "@shared/search-editions";

export const SUGGESTION_REFRESH_DELAY_MS = 1200;
export const MAX_SUGGESTION_REFRESHES = 3;
const SUGGESTION_TIMEOUT_MS = 25_000;
const NEXT_STEP: Record<SuggestionStep, SuggestionStep | undefined> = { publications: "topics", topics: "people", people: undefined };

export interface SuggestionBatch { id: number; fromPicks: boolean; grounded: boolean; items: SuggestedChoice[] }
export interface StepSuggestions { status: "idle" | "loading" | "ready" | "error"; batches: SuggestionBatch[]; refreshes: number; error?: string }
export interface SuggestionContext {
  focusDescription: string;
  industry?: string;
  searchEdition: SearchEditionId;
  /** Picked publication names; requests add each one's known URL. */
  publications: string[];
  topics: string[];
  /** What the user has picked on each step, from suggestions, the static list or typed in. */
  picks: Record<SuggestionStep, string[]>;
}
type State = Record<SuggestionStep, StepSuggestions>;

const idle = (): StepSuggestions => ({ status: "idle", batches: [], refreshes: 0 });
const initialState = (): State => ({ publications: idle(), topics: idle(), people: idle() });
const key = (value: string) => value.trim().toLowerCase();
const unique = (values: string[]) => [...new Map(values.map(value => [key(value), value])).values()];
const shownNames = (step: StepSuggestions) => step.batches.flatMap(batch => batch.items.map(item => item.name));

function failureMessage(error: unknown, timedOut: boolean) {
  if (timedOut) return "Suggestions took too long.";
  if (error instanceof ApiError && error.status === 429) return "You've asked for a lot of suggestions. Try again in a few minutes.";
  return "Suggestions are unavailable right now.";
}

async function fetchSuggestions(step: SuggestionStep, body: unknown, signal: AbortSignal): Promise<SuggestionResult> {
  const request = (async () => {
    const response = await apiRequest("POST", "/api/onboarding/suggestions", body, { signal });
    return parseOnboardingSuggestions(step, await response.json());
  })();
  // Settle on abort even if the response body never finishes.
  return await new Promise<SuggestionResult>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    request.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Per-step onboarding suggestions from live news. Each step loads when the user reaches it,
 * refreshes (up to three times) a moment after they pick something new, and prefetches the
 * next step with their latest picks so it is usually ready on arrival. Suggestions are never
 * selected for the user; `catalog` keeps every suggestion's URL and weight for the final save.
 */
export function useOnboardingSuggestions(step: SuggestionStep | undefined, enabled: boolean, context: SuggestionContext) {
  const [state, setState] = useState<State>(initialState);
  const [catalog, setCatalog] = useState<SuggestedChoice[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const contextRef = useRef(context);
  contextRef.current = context;
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const requests = useRef(new Map<SuggestionStep, AbortController>());
  const prefetches = useRef(new Map<SuggestionStep, { key: string; controller: AbortController; promise: Promise<SuggestionResult> }>());
  // The picks each step's latest request already reflects; only a new pick triggers a refresh.
  const requestedPicks = useRef(new Map<SuggestionStep, string[]>());
  const batchId = useRef(0);

  const buildRequest = useCallback((target: SuggestionStep, shown: string[]) => {
    const current = contextRef.current;
    const candidates = catalogRef.current.flatMap(item => item.kind === "source" && item.url ? [{ name: item.name, url: item.url }] : []);
    const publications = current.publications.slice(0, 20).map(name => {
      const url = selectedPublicationCandidates([name], candidates)[0]?.url;
      return url ? { name, url } : { name };
    });
    return {
      step: target,
      focusDescription: current.focusDescription.trim(),
      ...(current.industry ? { industry: current.industry } : {}),
      searchEdition: current.searchEdition,
      publications,
      topics: current.topics.slice(0, 20),
      exclude: unique([...shown, ...current.picks[target]]).slice(0, 200),
    };
  }, []);

  const apply = useCallback((target: SuggestionStep, result: SuggestionResult, fromPicks: boolean) => {
    setCatalog(items => {
      const known = new Set(items.map(item => `${item.kind}:${key(item.name)}`));
      return [...items, ...result.items.filter(item => !known.has(`${item.kind}:${key(item.name)}`))];
    });
    setState(previous => {
      const current = previous[target];
      const hidden = new Set([...shownNames(current), ...contextRef.current.picks[target]].map(key));
      const items = result.items.filter(item => !hidden.has(key(item.name)));
      const batches = fromPicks && !items.length ? current.batches
        : [...current.batches, { id: ++batchId.current, fromPicks, grounded: result.grounded, items }];
      return { ...previous, [target]: { ...current, status: "ready", error: undefined, batches, refreshes: current.refreshes + (fromPicks ? 1 : 0) } };
    });
  }, []);

  const prefetch = useCallback((target: SuggestionStep | undefined) => {
    if (!target || stateRef.current[target].status !== "idle" || requests.current.has(target)) return;
    const body = buildRequest(target, []);
    const requestKey = JSON.stringify(body);
    const existing = prefetches.current.get(target);
    if (existing?.key === requestKey) return;
    existing?.controller.abort();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUGGESTION_TIMEOUT_MS);
    const promise = fetchSuggestions(target, body, controller.signal).finally(() => clearTimeout(timer));
    promise.catch(() => { if (prefetches.current.get(target)?.promise === promise) prefetches.current.delete(target); });
    prefetches.current.set(target, { key: requestKey, controller, promise });
  }, [buildRequest]);

  const load = useCallback(async (target: SuggestionStep, fromPicks: boolean) => {
    if (requests.current.has(target)) return;
    const body = buildRequest(target, shownNames(stateRef.current[target]));
    const controller = new AbortController();
    requests.current.set(target, controller);
    requestedPicks.current.set(target, contextRef.current.picks[target]);
    setState(previous => ({ ...previous, [target]: { ...previous[target], status: "loading", error: undefined } }));
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, SUGGESTION_TIMEOUT_MS);
    try {
      const prefetched = prefetches.current.get(target);
      prefetches.current.delete(target);
      let result: SuggestionResult;
      if (!fromPicks && prefetched?.key === JSON.stringify(body)) {
        controller.signal.addEventListener("abort", () => prefetched.controller.abort(), { once: true });
        result = await prefetched.promise;
      } else {
        prefetched?.controller.abort();
        result = await fetchSuggestions(target, body, controller.signal);
      }
      if (controller.signal.aborted) return;
      apply(target, result, fromPicks);
      if (!fromPicks) prefetch(NEXT_STEP[target]);
    } catch (error) {
      // A cancelled request leaves its status to whoever cancelled it.
      if (controller.signal.aborted && !timedOut) return;
      setState(previous => ({ ...previous, [target]: { ...previous[target], status: "error", error: failureMessage(error, timedOut) } }));
    } finally {
      clearTimeout(timer);
      if (requests.current.get(target) === controller) requests.current.delete(target);
    }
  }, [apply, buildRequest, prefetch]);

  const abortAll = useCallback(() => {
    for (const controller of requests.current.values()) controller.abort();
    requests.current.clear();
    for (const { controller } of prefetches.current.values()) controller.abort();
    prefetches.current.clear();
  }, []);

  /** Stop all work and discard late results; steps keep what they already showed. */
  const cancel = useCallback(() => {
    abortAll();
    setState(previous => {
      const loading = (Object.keys(previous) as SuggestionStep[]).filter(target => previous[target].status === "loading");
      if (!loading.length) return previous;
      const next = { ...previous };
      for (const target of loading) next[target] = { ...next[target], status: next[target].batches.length ? "ready" : "idle" };
      return next;
    });
  }, [abortAll]);

  /** Start over, e.g. after the focus changes. Metadata for earlier picks stays in the catalog. */
  const reset = useCallback(() => {
    abortAll();
    requestedPicks.current.clear();
    stateRef.current = initialState();
    setState(stateRef.current);
  }, [abortAll]);

  const retry = useCallback((target: SuggestionStep) => {
    void load(target, stateRef.current[target].batches.length > 0);
  }, [load]);

  useEffect(() => abortAll, [abortAll]);
  useEffect(() => { if (!enabled) cancel(); }, [enabled, cancel]);

  const status = step ? state[step].status : undefined;
  useEffect(() => {
    if (enabled && step && status === "idle") void load(step, false);
  }, [enabled, step, status, load]);

  const refreshes = step ? state[step].refreshes : 0;
  const picksKey = step ? context.picks[step].map(key).join("\n") : "";
  useEffect(() => {
    if (!enabled || !step || status !== "ready" || refreshes >= MAX_SUGGESTION_REFRESHES) return;
    const requested = new Set((requestedPicks.current.get(step) ?? []).map(key));
    if (!picksKey.split("\n").some(pick => pick && !requested.has(pick))) return;
    const timer = setTimeout(() => {
      void load(step, true);
      prefetch(NEXT_STEP[step]);
    }, SUGGESTION_REFRESH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled, step, status, refreshes, picksKey, load, prefetch]);

  return { state, catalog, retry, reset, cancel };
}
