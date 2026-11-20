import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import {
  addDays, MAX_EXTRA_IDEA_IDS, MOMENT_FETCH_DAYS, momentIdeaId, parseMoments, zonedParts,
  type CheckinAnswers, type CheckinResponse, type ContentStrategy, type IdeasResponse, type IdeaState, type IndustryMoment, type PlanResponse, type RankedIdea, type StrategyResponse, type TopicIdea,
} from "@shared/topic-ideas";

export const STRATEGY_KEY = ["/api/strategy"] as const;
export const IDEAS_KEY = ["/api/ideas"] as const;
export const CHECKIN_KEY = ["/api/checkins/current"] as const;
export const PLAN_DAYS = 30;
const withExtra = (url: string, extra: readonly string[]) => extra.length ? `${url}${url.includes("?") ? "&" : "?"}extra=${extra.join(",")}` : url;

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  return (await apiRequest("GET", url, undefined, { signal })).json() as Promise<T>;
}

export const strategyQuery = (enabled: boolean) => ({ queryKey: STRATEGY_KEY, queryFn: ({ signal }: { signal: AbortSignal }) => getJson<StrategyResponse>("/api/strategy", signal), enabled });
/** `extra`: moment idea ids whose saved / dismissed / drafted states the server should return. */
export const ideasQuery = (extra: readonly string[], enabled: boolean) => ({
  queryKey: [...IDEAS_KEY, extra.join(",")], queryFn: ({ signal }: { signal: AbortSignal }) => getJson<IdeasResponse>(withExtra("/api/ideas", extra), signal), enabled,
});
/** Always refetched on mount: another tab may have answered, or a new week may have started. */
export const checkinQuery = (enabled: boolean) => ({
  queryKey: CHECKIN_KEY, queryFn: ({ signal }: { signal: AbortSignal }) => getJson<CheckinResponse>("/api/checkins/current", signal), enabled, staleTime: 0,
});
export const planQuery = (days: number, extra: readonly string[], enabled: boolean) => ({
  queryKey: ["/api/plan", days, extra.join(",")], queryFn: ({ signal }: { signal: AbortSignal }) => getJson<PlanResponse>(withExtra(`/api/plan?days=${days}`, extra), signal), enabled,
});

/** Today's date in this browser; moments are whole days, so the browser zone is close enough. */
export const localToday = (now = new Date()) => zonedParts(now, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC").date;

const NO_MOMENTS: IndustryMoment[] = [];
/**
 * Industry moments (Phase 5) from yesterday for the longest window the API allows, so lead-ups that start inside
 * the plan are found. Optional: any error, including 404 before Phase 5 ships, means no moments.
 */
export function useMoments(enabled: boolean) {
  const today = useMemo(() => localToday(), []);
  const from = addDays(today, -1), to = addDays(from, MOMENT_FETCH_DAYS);
  const query = useQuery({
    queryKey: ["/api/moments", "topic-ideas", from, to],
    queryFn: async ({ signal }): Promise<IndustryMoment[]> => {
      try { return parseMoments(await getJson<unknown>(`/api/moments?from=${from}&to=${to}`, signal)); }
      catch (error) { if (signal.aborted) throw error; return NO_MOMENTS; }
    },
    enabled, staleTime: 5 * 60_000,
  });
  // Only as many moments as the server can return states for, soonest first.
  const moments = useMemo(() => [...(query.data ?? NO_MOMENTS)].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(0, MAX_EXTRA_IDEA_IDS), [query.data]);
  const extra = useMemo(() => [...new Set(moments.map(momentIdeaId))].sort(), [moments]);
  return { today, moments, extra, ready: query.isSuccess || query.isError };
}

export class StrategyConflict extends Error {
  constructor(message: string, readonly current: StrategyResponse) { super(message); }
}

export async function saveStrategy(revision: number, strategy: ContentStrategy): Promise<StrategyResponse> {
  try { return await (await apiRequest("PUT", "/api/strategy", { revision, strategy })).json(); }
  catch (error) {
    const current = error instanceof ApiError && error.status === 409 ? (error.details as { current?: StrategyResponse } | undefined)?.current : undefined;
    if (current) throw new StrategyConflict(error instanceof Error ? error.message : "Your strategy changed.", current);
    throw error;
  }
}

export class CheckinConflict extends Error {
  constructor(message: string, readonly current: CheckinResponse) { super(message); }
}

/** `replace` only from the edit flow, after the person has seen the saved answers. 409 → CheckinConflict with this week's state. */
export async function saveCheckin(input: { weekStart: string; answers: CheckinAnswers; replace?: boolean }): Promise<CheckinResponse> {
  try { return await (await apiRequest("PUT", "/api/checkins/current", { weekStart: input.weekStart, answers: input.answers, replace: input.replace ?? false })).json(); }
  catch (error) {
    const current = error instanceof ApiError && error.status === 409 ? (error.details as { current?: CheckinResponse } | undefined)?.current : undefined;
    if (current) throw new CheckinConflict(error instanceof Error ? error.message : "This week's check-in changed.", current);
    throw error;
  }
}

/** Saved and drafted ideas send a snapshot so they stay listed after their source story leaves the Inbox. */
export async function updateIdeaState(idea: TopicIdea, state: IdeaState | null): Promise<void> {
  const { id, title, angle, pillar, kind, why, sourceStory, momentDate, score } = idea;
  const snapshot = { id, title, angle, pillar, kind, why, score, ...(sourceStory ? { sourceStory } : {}), ...(momentDate ? { momentDate } : {}) };
  await apiRequest("PATCH", `/api/ideas/${encodeURIComponent(idea.id)}`, state === "saved" || state === "used" ? { state, idea: snapshot } : { state });
}

/** Optimistic cache change: dismissed ideas leave the list, other states update in place (or come back at `index`). */
export function withIdeaState(data: IdeasResponse, idea: RankedIdea, state: IdeaState | null, index?: number): IdeasResponse {
  const states = { ...data.states };
  if (state) states[idea.id] = state; else delete states[idea.id];
  const next = state === "dismissed" ? null : state;
  let ideas = data.ideas.filter(entry => state !== "dismissed" || entry.id !== idea.id);
  if (state !== "dismissed") {
    ideas = ideas.some(entry => entry.id === idea.id) ? ideas.map(entry => entry.id === idea.id ? { ...entry, state: next } : entry)
      : idea.kind === "moment" ? ideas : [...ideas.slice(0, index ?? 0), { ...idea, state: next }, ...ideas.slice(index ?? 0)];
  }
  return { ...data, ideas, states };
}

export function refreshTopicQueries() {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: IDEAS_KEY }),
    queryClient.invalidateQueries({ queryKey: ["/api/plan"] }),
  ]);
}
