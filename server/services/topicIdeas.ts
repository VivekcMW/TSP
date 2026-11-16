import { storage, type TenantScope } from "../storage";
import { strategyRepository, type SavedStrategy } from "../repositories/strategy";
import { personalTrends, trendTopicLabels } from "./personalTrends";
import type { InboxListItem } from "@shared/schema";
import {
  buildPlan, generateIdeas, rankIdeas, safeTimeZone, suggestStrategy, validTime, weekStartOf,
  type CheckinAnswers, type CheckinResponse, type ContentStrategy, type IdeasResponse, type IdeaState, type PlanResponse, type StoryInput, type StrategyResponse, type TopicIdea,
} from "@shared/topic-ideas";

const DAY_MS = 86_400_000;
const FOLLOW_UP_WINDOW_MS = 60 * DAY_MS;
const STORY_LIMIT = 40;
const PLAN_IDEA_POOL = 200;

interface StrategyContext {
  timeZone: string;
  fallbackTime: string;
  saved: SavedStrategy | null;
  suggested: ContentStrategy;
  /** The saved strategy, or the profile-based suggestion until one is saved. */
  strategy: ContentStrategy;
  hasStrategy: boolean;
}

async function loadContext(scope: TenantScope): Promise<StrategyContext> {
  const [profile, saved] = await Promise.all([storage.getUserProfile(scope), strategyRepository.getStrategy(scope)]);
  const suggested = suggestStrategy(profile);
  return {
    timeZone: safeTimeZone(profile?.timezone), fallbackTime: validTime(profile?.preferredPublishTime),
    saved, suggested, strategy: saved?.strategy ?? suggested, hasStrategy: Boolean(saved?.strategy),
  };
}

/** One missing source (for example trends) should not stop the other ideas. */
async function optional<T>(label: string, work: Promise<T>, fallback: T): Promise<T> {
  try { return await work; }
  catch (error) { console.warn(`Topic ideas: ${label} unavailable:`, error instanceof Error ? error.message : error); return fallback; }
}

const toStory = (item: InboxListItem): StoryInput => ({
  id: item.id, headline: item.headline, source: item.source, url: item.articleUrl,
  relevance: Number(item.relevanceScore) || 0, matchedKeywords: Array.isArray(item.matchedKeywords) ? item.matchedKeywords.filter(k => typeof k === "string") : [],
});

async function candidates(scope: TenantScope, context: StrategyContext, now: Date): Promise<TopicIdea[]> {
  const [trendRows, stories, checkins, published] = await Promise.all([
    optional("trends", storage.getInboxDiscoveryWindow(scope, now), []),
    optional("stories", storage.getInboxItems(scope, { status: "active", order: "relevance", snoozed: "exclude", limit: STORY_LIMIT }), []),
    optional("check-ins", strategyRepository.recentCheckins(scope, 8), []),
    optional("published posts", strategyRepository.publishedPosts(scope, new Date(now.getTime() - FOLLOW_UP_WINDOW_MS)), []),
  ]);
  const labels = trendTopicLabels(trendRows);
  const trends = personalTrends(trendRows, now, 5).map(({ topic, count, previousCount, label }) => ({ topic: labels.get(topic) ?? topic, count, previousCount, label }));
  return generateIdeas({ strategy: context.strategy, trends, stories: stories.map(toStory), checkins, published, now, timeZone: context.timeZone });
}

const strategyResponse = (context: StrategyContext): StrategyResponse => ({
  saved: context.hasStrategy,
  revision: context.saved?.revision ?? 0,
  updatedAt: context.saved?.updatedAt.toISOString() ?? null,
  strategy: context.saved?.strategy ?? null,
  suggested: context.suggested,
  timezone: context.timeZone,
});

export async function getStrategy(scope: TenantScope): Promise<StrategyResponse> {
  return strategyResponse(await loadContext(scope));
}

/** Throws StrategyConflictError (from the repository) when `revision` is stale. */
export async function saveStrategy(scope: TenantScope, revision: number, strategy: ContentStrategy): Promise<StrategyResponse> {
  const saved = await strategyRepository.saveStrategy(scope, strategy, revision);
  const profile = await storage.getUserProfile(scope);
  return {
    saved: Boolean(saved.strategy), revision: saved.revision, updatedAt: saved.updatedAt.toISOString(), strategy: saved.strategy,
    suggested: suggestStrategy(profile), timezone: safeTimeZone(profile?.timezone),
  };
}

async function currentWeek(scope: TenantScope, now: Date) {
  const profile = await storage.getUserProfile(scope);
  return weekStartOf(now, safeTimeZone(profile?.timezone));
}

export async function getCurrentCheckin(scope: TenantScope, now = new Date()): Promise<CheckinResponse> {
  const weekStart = await currentWeek(scope, now);
  return { weekStart, checkin: await strategyRepository.getCheckin(scope, weekStart) };
}

export class CheckinWeekError extends Error {
  constructor() { super("A new week has started. Here is this week's check-in."); }
}

/**
 * Saves (or skips, with empty answers) the check-in for `weekStart`, which must be the current week in the profile
 * time zone (else CheckinWeekError). Answers saved elsewhere are only replaced with `replace` (else CheckinConflictError).
 */
export async function saveCurrentCheckin(scope: TenantScope, weekStart: string, answers: CheckinAnswers, replace: boolean, now = new Date()): Promise<CheckinResponse> {
  if (weekStart !== await currentWeek(scope, now)) throw new CheckinWeekError();
  return { weekStart, checkin: await strategyRepository.saveCheckin(scope, weekStart, answers, replace) };
}

async function statesFor(scope: TenantScope, ideas: readonly TopicIdea[], extra: readonly string[]) {
  const stored = await strategyRepository.loadIdeaStates(scope, [...ideas.map(idea => idea.id), ...extra]);
  const wanted = new Set(extra);
  return { stored, extra: Object.fromEntries(stored.filter(entry => wanted.has(entry.ideaId)).map(entry => [entry.ideaId, entry.state])) as Record<string, IdeaState> };
}

/** `extra`: ids of ideas the client adds itself (moments) whose states it needs. */
export async function getTopicIdeas(scope: TenantScope, extra: readonly string[] = [], now = new Date()): Promise<IdeasResponse> {
  const context = await loadContext(scope);
  const ideas = await candidates(scope, context, now);
  const states = await statesFor(scope, ideas, extra);
  return { ideas: rankIdeas(ideas, states.stored), states: states.extra, hasStrategy: context.hasStrategy, generatedAt: now.toISOString() };
}

export function setIdeaState(scope: TenantScope, ideaId: string, state: IdeaState | null, idea?: TopicIdea) {
  return strategyRepository.setIdeaState(scope, ideaId, state, idea);
}

/** Suggestions only: reads scheduled posts and never schedules or changes anything. */
export async function getContentPlan(scope: TenantScope, days: number, extra: readonly string[] = [], now = new Date()): Promise<PlanResponse> {
  const context = await loadContext(scope);
  // Two extra days cover any time-zone offset; buildPlan trims to the exact local window.
  const [ideas, scheduled] = await Promise.all([
    candidates(scope, context, now),
    strategyRepository.scheduledPosts(scope, now, new Date(now.getTime() + (days + 2) * DAY_MS)),
  ]);
  const states = await statesFor(scope, ideas, extra);
  return buildPlan({
    now, days, timeZone: context.timeZone, strategy: context.strategy, fallbackTime: context.fallbackTime, hasStrategy: context.hasStrategy,
    scheduled, ideas: rankIdeas(ideas, states.stored, PLAN_IDEA_POOL), states: states.extra,
  });
}
