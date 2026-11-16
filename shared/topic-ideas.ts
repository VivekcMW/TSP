import { z } from "zod";

/**
 * Phase 3 topic discovery: a person's content strategy, weekly experience check-ins, explainable topic
 * ideas and a 30-day posting plan. Everything here is deterministic (no AI): the same inputs always
 * produce the same ideas, ids and plan, so every suggestion can be explained with its `why`.
 */

// ── Strategy ──────────────────────────────────────────────────────────────

export const STRATEGY_GOALS = ["grow_audience", "build_authority", "attract_clients", "hire", "other"] as const;
export type StrategyGoal = typeof STRATEGY_GOALS[number];
export const GOAL_LABELS: Record<StrategyGoal, string> = {
  grow_audience: "Grow my audience", build_authority: "Build authority", attract_clients: "Attract clients", hire: "Hire people", other: "Something else",
};
export type Expertise = 1 | 2 | 3;
export const EXPERTISE_LABELS: Record<Expertise, string> = { 1: "Learning", 2: "Practitioner", 3: "Expert" };
export const MAX_PILLARS = 5;
export const MAX_SLOTS = 14;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** 0 = Sunday … 6 = Saturday, like Date#getDay. */
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const text = (max: number, label = "This answer") => z.string().trim().max(max, `${label} can be at most ${max} characters.`);
const unique = <T>(key: (item: T) => string) => (items: readonly T[]) => new Set(items.map(key)).size === items.length;

export const pillarSchema = z.object({
  name: z.string().trim().min(1, "Name each pillar.").max(60, "Pillar names are at most 60 characters."),
  expertise: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  proof: text(200, "A pillar's story or result").default(""),
}).strict();
export const slotSchema = z.object({
  weekday: z.number().int().min(0, "Choose a day.").max(6, "Choose a day."),
  time: z.string().regex(TIME_PATTERN, "Use a time like 09:00."),
}).strict();
export const cadenceSchema = z.object({
  postsPerWeek: z.number().int().min(1, "Post at least once a week.").max(7, "Post at most 7 times a week."),
  slots: z.array(slotSchema).max(MAX_SLOTS, `Add at most ${MAX_SLOTS} posting times.`)
    .refine(unique(slot => `${slot.weekday} ${slot.time}`), "Each posting time must be different."),
}).strict();
export const contentStrategySchema = z.object({
  audience: text(200, "Audience").default(""),
  goal: z.enum(STRATEGY_GOALS, { errorMap: () => ({ message: "Choose a goal." }) }),
  goalNote: text(120, "The goal note").default(""),
  pillars: z.array(pillarSchema).max(MAX_PILLARS, `Add at most ${MAX_PILLARS} pillars.`)
    .refine(unique(pillar => pillar.name.toLowerCase()), "Each pillar needs a different name."),
  cadence: cadenceSchema,
}).strict();
export type ContentPillar = z.output<typeof pillarSchema>;
export type PostingSlot = z.output<typeof slotSchema>;
export type ContentStrategy = z.output<typeof contentStrategySchema>;

export const strategyUpdateSchema = z.object({ revision: z.number().int().min(0), strategy: contentStrategySchema }).strict();

/** `strategy` is null until saved; `suggested` is always derived from the profile and never saved by GET. */
export interface StrategyResponse {
  saved: boolean;
  revision: number;
  updatedAt: string | null;
  strategy: ContentStrategy | null;
  suggested: ContentStrategy;
  /** Profile time zone that posting times are in. */
  timezone: string;
}

export interface ProfileHints {
  keywords?: ReadonlyArray<{ keyword?: unknown; weight?: unknown }> | null;
  preferredPublishTime?: string | null;
}

/** Up to `limit` distinct keywords, heaviest first (stable for equal weights). */
export function topKeywords(keywords: ProfileHints["keywords"], limit = MAX_PILLARS): string[] {
  const seen = new Set<string>();
  return (keywords ?? [])
    .map((entry, index) => ({ name: typeof entry?.keyword === "string" ? entry.keyword.trim().slice(0, 60).trim() : "", weight: Number(entry?.weight), index }))
    .filter(entry => entry.name && !seen.has(entry.name.toLowerCase()) && seen.add(entry.name.toLowerCase()))
    .sort((a, b) => (Number.isFinite(b.weight) ? b.weight : 0) - (Number.isFinite(a.weight) ? a.weight : 0) || a.index - b.index)
    .slice(0, limit)
    .map(entry => entry.name);
}

export const validTime = (value: string | null | undefined, fallback = "09:00") => value && TIME_PATTERN.test(value) ? value : fallback;

export function suggestStrategy(profile: ProfileHints | null | undefined): ContentStrategy {
  const time = validTime(profile?.preferredPublishTime);
  return {
    audience: "", goal: "build_authority", goalNote: "",
    pillars: topKeywords(profile?.keywords).map(name => ({ name, expertise: 2, proof: "" })),
    cadence: { postsPerWeek: 3, slots: [1, 3, 5].map(weekday => ({ weekday, time })) },
  };
}

// ── Weekly experience check-ins ───────────────────────────────────────────

export const CHECKIN_FIELDS = ["win", "lesson", "question"] as const;
export type CheckinField = typeof CHECKIN_FIELDS[number];
export const CHECKIN_LIMIT = 500;
export const checkinAnswersSchema = z.object({
  win: text(CHECKIN_LIMIT).default(""), lesson: text(CHECKIN_LIMIT).default(""), question: text(CHECKIN_LIMIT).default(""),
}).strict();
export type CheckinAnswers = z.output<typeof checkinAnswersSchema>;
/**
 * `weekStart` is the week the person answered (it must still be the current week). Without `replace`, an
 * answered check-in is never overwritten (a stale tab's Save or Skip gets 409); a skipped one can be.
 */
export const checkinUpdateSchema = z.object({
  weekStart: z.string().regex(DATE_PATTERN, "Reload to answer this week's check-in."),
  answers: checkinAnswersSchema,
  replace: z.boolean().optional().default(false),
}).strict();
export interface ExperienceCheckin { weekStart: string; answers: CheckinAnswers; updatedAt: string }
/** `checkin` is null until the person saves or skips the current week (a skip stores empty answers). */
export interface CheckinResponse { weekStart: string; checkin: ExperienceCheckin | null }
export const isSkippedCheckin = (answers: CheckinAnswers) => CHECKIN_FIELDS.every(field => !answers[field].trim());

// ── Time zones (profile time zone, DST-safe) ──────────────────────────────

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(timeZone, format);
  }
  return format;
}

export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try { formatter(timeZone); return timeZone; } catch { return "UTC"; }
}

const pad = (value: number) => String(value).padStart(2, "0");
function wallClock(instant: number, timeZone: string) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute), second: Number(parts.second) };
}
const offsetAt = (instant: number, timeZone: string) => {
  const wall = wallClock(instant, timeZone);
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - Math.floor(instant / 1000) * 1000;
};

/** Local calendar date, time and weekday of an instant in a time zone. */
export function zonedParts(instant: Date, timeZone: string): { date: string; time: string; weekday: number } {
  const wall = wallClock(instant.getTime(), timeZone);
  const date = `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`;
  return { date, time: `${pad(wall.hour)}:${pad(wall.minute)}`, weekday: weekdayOf(date) };
}

/**
 * The instant a local wall-clock time happens. Times skipped by a DST jump move forward by the gap
 * (02:30 → 03:30); repeated times use the first occurrence.
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const before = offsetAt(wall - 86_400_000, timeZone);
  const after = offsetAt(wall + 86_400_000, timeZone);
  const valid = [...new Set([before, after])].map(offset => wall - offset).filter(candidate => offsetAt(candidate, timeZone) === wall - candidate);
  return new Date(valid.length ? Math.min(...valid) : wall - before);
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
export function weekdayOf(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
export const mondayOf = (date: string) => addDays(date, -((weekdayOf(date) + 6) % 7));
/** Monday of the current week in the person's time zone. */
export const weekStartOf = (instant: Date, timeZone: string) => mondayOf(zonedParts(instant, timeZone).date);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "16 Nov" — locale-independent so ideas stay identical on server and client. */
export const shortDate = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1] ?? ""}`.trim();

// ── Topic ideas ───────────────────────────────────────────────────────────

export const IDEA_KINDS = ["pillar", "signal", "story", "experience", "follow-up", "moment"] as const;
export type IdeaKind = typeof IDEA_KINDS[number];
export const IDEA_KIND_LABELS: Record<IdeaKind, string> = {
  pillar: "Pillar", signal: "Signal", story: "Story", experience: "Your experience", "follow-up": "Follow-up", moment: "Moment",
};
export const IDEA_STATES = ["saved", "dismissed", "used"] as const;
export type IdeaState = typeof IDEA_STATES[number];
export const IDEA_ID_PATTERN = /^[0-9a-f]{16}$/;
export const IDEA_LIMIT = 30;
export const MAX_SAVED_IDEAS = 20;
/** Older dismissed and drafted states beyond this many are pruned. */
export const IDEA_STATE_HISTORY = 2000;

export const sourceStorySchema = z.object({
  inboxItemId: z.string().min(1).max(100),
  headline: z.string().min(1).max(500),
  source: z.string().max(200),
  url: z.string().max(2048).refine(value => /^https?:\/\//i.test(value), "Use an http(s) link."),
}).strict();
export const topicIdeaSchema = z.object({
  id: z.string().regex(IDEA_ID_PATTERN),
  title: z.string().trim().min(1).max(200),
  angle: z.string().trim().min(1).max(200),
  pillar: z.string().trim().max(60).nullable(),
  kind: z.enum(IDEA_KINDS),
  why: z.string().trim().max(300),
  sourceStory: sourceStorySchema.optional(),
  momentDate: z.string().regex(DATE_PATTERN).optional(),
  score: z.number().finite().min(0).max(2),
}).strict();
export type TopicIdea = z.output<typeof topicIdeaSchema>;
export type RankedIdea = TopicIdea & { state: Exclude<IdeaState, "dismissed"> | null };
/** null clears the state (Undo, or un-save). A snapshot keeps saved ideas after their source story is gone. */
export const ideaStateUpdateSchema = z.object({ state: z.enum(IDEA_STATES).nullable(), idea: topicIdeaSchema.optional() }).strict();

/** Ideas the client merges itself (moments) send their ids as `extra=id,id` so the server returns their exact states. */
export const MAX_EXTRA_IDEA_IDS = 50;
export const extraIdeaIdsSchema = z.string().max(MAX_EXTRA_IDEA_IDS * 17).optional()
  .transform(value => value ? [...new Set(value.split(","))] : [])
  .refine(ids => ids.length <= MAX_EXTRA_IDEA_IDS && ids.every(id => IDEA_ID_PATTERN.test(id)), "Unknown idea ids.");
export const ideasQuerySchema = z.object({ extra: extraIdeaIdsSchema });

export interface IdeasResponse {
  ideas: RankedIdea[];
  /** States of the requested `extra` ids, so ideas merged on the client (moments) honour Save and Not for me. */
  states: Record<string, IdeaState>;
  hasStrategy: boolean;
  generatedAt: string;
}

export interface TrendInput { topic: string; count: number; previousCount: number; label: "new" | "continuing" }
export interface StoryInput { id: string; headline: string; source: string; url: string; relevance: number; matchedKeywords: readonly string[] }
export interface CheckinInput { weekStart: string; answers: CheckinAnswers }
export interface PublishedInput { id: string; content: string; publishedAt: string }
export interface IdeaInputs {
  strategy: ContentStrategy;
  trends: readonly TrendInput[];
  stories: readonly StoryInput[];
  checkins: readonly CheckinInput[];
  published: readonly PublishedInput[];
  now: Date;
  timeZone: string;
}

function fnv1a(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(16).padStart(8, "0");
}
/** Stable 16-hex id from what an idea is about, so Save and Not for me persist across regenerations. */
export function ideaId(kind: IdeaKind, source: string, template: string): string {
  const key = `${kind}\u0000${source.trim().toLowerCase()}\u0000${template}`;
  return fnv1a(key, 0x811c9dc5) + fnv1a(key, 0x5bd1e995);
}

/** Shortens at a word boundary and adds an ellipsis. */
export function clip(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}
const words = (value: string) => ` ${value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
/** First pillar (in strategy order) named in the text as whole words. */
export function matchPillar(textValue: string, pillars: readonly ContentPillar[]): string | null {
  const haystack = words(textValue);
  return pillars.find(pillar => words(pillar.name).trim() && haystack.includes(words(pillar.name)))?.name ?? null;
}
function matchKeywords(keywords: readonly string[], pillars: readonly ContentPillar[]): string | null {
  return pillars.find(pillar => keywords.some(keyword => {
    const a = words(keyword), b = words(pillar.name);
    return a.trim() && b.trim() && (a.includes(b) || b.includes(a));
  }))?.name ?? null;
}
export const audienceLabel = (strategy: Pick<ContentStrategy, "audience">) => strategy.audience.trim() ? clip(strategy.audience, 80) : "your audience";
const round = (value: number) => Math.round(Math.max(0, Math.min(2, value)) * 1000) / 1000;
const goalPhrase: Partial<Record<StrategyGoal, string>> = {
  grow_audience: "grow your audience", build_authority: "build authority", attract_clients: "attract clients", hire: "hire people",
};

interface PillarTemplate {
  key: string;
  /** Score added per expertise level (learning, practitioner, expert); null = not offered at that level. */
  fit: readonly [number | null, number | null, number | null];
  goals: Partial<Record<StrategyGoal, number>>;
  title: (pillar: string) => string;
  angle: (pillar: string, audience: string, proof: string) => string;
  why: string;
  needsProof?: boolean;
}
const PILLAR_TEMPLATES: readonly PillarTemplate[] = [
  { key: "myth", fit: [null, 0.1, 0.2], goals: { build_authority: 0.12, attract_clients: 0.06 }, title: p => `Myth vs reality: ${p}`,
    angle: p => `Name a common belief about ${p} and show what you see in practice.`, why: "Correcting a common belief shows your judgment." },
  { key: "mistakes", fit: [null, 0.15, 0.15], goals: { attract_clients: 0.12, build_authority: 0.06 }, title: p => `Mistakes I see in ${p}`,
    angle: p => `Share three mistakes people make with ${p} and how to avoid each one.`, why: "Avoidable mistakes are practical and easy to act on." },
  { key: "approach", fit: [null, 0.1, 0.15], goals: { attract_clients: 0.1 }, title: p => `How I'd approach ${p} today`,
    angle: p => `Walk through how you would start with ${p} today, step by step.`, why: "Showing your approach lets people see how you work." },
  { key: "changed", fit: [0.05, 0.1, 0.1], goals: { grow_audience: 0.1, build_authority: 0.05 }, title: p => `What changed in ${p} this year`,
    angle: (p, audience) => `Pick the biggest change in ${p} this year and what it means for ${audience}.`, why: "Timely posts give people a reason to read now." },
  { key: "lessons", fit: [0.1, 0.1, 0.1], goals: { grow_audience: 0.06, hire: 0.06 }, title: p => `Lessons learned from ${p}`,
    angle: p => `Share one lesson ${p} taught you, the moment you learned it and what you do differently now.`, why: "Lessons from experience are personal and hard to copy." },
  { key: "prediction", fit: [null, 0.05, 0.2], goals: { build_authority: 0.12 }, title: p => `A prediction for ${p}`,
    angle: p => `Make one specific prediction about ${p} for the next 12 months and explain why.`, why: "A clear prediction invites discussion." },
  { key: "checklist", fit: [null, 0.1, 0.1], goals: { grow_audience: 0.12, attract_clients: 0.05 }, title: p => `A ${p} checklist`,
    angle: p => `Share a short checklist for ${p} that people can save and use.`, why: "Checklists are useful and often saved." },
  { key: "behind", fit: [0.05, 0.1, 0.1], goals: { hire: 0.15, grow_audience: 0.04 }, title: p => `Behind the scenes: ${p}`,
    angle: p => `Show how you or your team actually work on ${p} day to day.`, why: "Behind-the-scenes posts show your work and your team." },
  { key: "learning", fit: [0.2, null, null], goals: { grow_audience: 0.08 }, title: p => `What I'm learning about ${p}`,
    angle: p => `Share what you are learning about ${p} right now and what surprised you.`, why: "Learning in public builds trust while you grow." },
  { key: "question", fit: [0.15, 0.05, null], goals: { grow_audience: 0.06 }, title: p => `A question I'm exploring in ${p}`,
    angle: p => `Ask your network one honest question about ${p} and share your current thinking.`, why: "A good question starts conversations." },
  { key: "proof", fit: [0.1, 0.15, 0.2], goals: { attract_clients: 0.15, build_authority: 0.08, hire: 0.05 }, needsProof: true,
    title: p => `The story behind a ${p} result`, angle: (_p, _a, proof) => `Tell this story: ${proof}`, why: "It uses the story or result you added to this pillar." },
];

function pillarIdeas(strategy: ContentStrategy): TopicIdea[] {
  const audience = audienceLabel(strategy);
  const goal = strategy.goal;
  return strategy.pillars.flatMap((pillar, index) => PILLAR_TEMPLATES.flatMap(template => {
    const fit = template.fit[pillar.expertise - 1];
    if (fit === null || (template.needsProof && !pillar.proof.trim())) return [];
    const boost = template.goals[goal] ?? 0;
    const goalWhy = boost >= 0.08 && goalPhrase[goal] ? ` It suits your goal to ${goalPhrase[goal]}.` : "";
    return [{
      id: ideaId("pillar", pillar.name, template.key), kind: "pillar" as const, pillar: pillar.name,
      title: clip(template.title(pillar.name), 200), angle: clip(template.angle(pillar.name, audience, pillar.proof.trim()), 200),
      why: clip(`${template.why} Your pillar: ${pillar.name} (${EXPERTISE_LABELS[pillar.expertise].toLowerCase()}).${goalWhy}`, 300),
      score: round(0.45 + fit + boost + 0.05 * (1 - index / MAX_PILLARS)),
    }];
  }));
}

function signalIdeas(strategy: ContentStrategy, trends: readonly TrendInput[]): TopicIdea[] {
  const audience = audienceLabel(strategy);
  return trends.filter(trend => trend.topic.trim() && trend.count >= 2).slice(0, 5).map(trend => {
    const topic = clip(trend.topic, 60);
    const pillar = matchKeywords([trend.topic], strategy.pillars);
    const change = trend.label === "new" || trend.previousCount === 0 ? "It is new compared with the week before." : `The week before it was ${trend.previousCount}.`;
    return {
      id: ideaId("signal", trend.topic, "rise"), kind: "signal" as const, pillar,
      title: clip(`What ${topic}'s rise means for ${audience}`, 200),
      angle: clip(`Explain why ${topic} keeps coming up and what ${audience} should do about it.`, 200),
      why: clip(`“${topic}” came up in ${trend.count} of your stories this week. ${change}`, 300),
      score: round(0.55 + Math.min(0.2, trend.count * 0.02) + (trend.count > trend.previousCount ? 0.05 : 0) + (pillar ? 0.1 : 0)),
    };
  });
}

function storyIdeas(strategy: ContentStrategy, stories: readonly StoryInput[]): TopicIdea[] {
  const audience = audienceLabel(strategy);
  return [...stories]
    .filter(story => story.relevance >= 0.6 && story.headline.trim() && /^https?:\/\//i.test(story.url))
    .sort((a, b) => b.relevance - a.relevance || (a.id < b.id ? -1 : 1))
    .slice(0, 12)
    .flatMap(story => {
      const pillar = matchKeywords(story.matchedKeywords, strategy.pillars) ?? matchPillar(story.headline, strategy.pillars);
      if (!pillar && story.relevance < 0.8) return [];
      const topics = story.matchedKeywords.filter(Boolean).slice(0, 3).join(", ");
      return [{
        id: ideaId("story", story.id, "my-take"), kind: "story" as const, pillar,
        title: clip(`My take on: ${story.headline}`, 200),
        angle: clip(`What this means for ${audience}, and what I would do next.`, 200),
        why: clip(`A ${Math.round(story.relevance * 100)}% match from ${story.source || "your sources"}${topics ? `, on ${topics}` : ""}.`, 300),
        sourceStory: { inboxItemId: story.id, headline: story.headline.slice(0, 500), source: story.source.slice(0, 200), url: story.url },
        score: round(0.5 + story.relevance * 0.35 + (pillar ? 0.1 : 0)),
      }];
    });
}

const EXPERIENCE: Record<CheckinField, { title: string; angle: string }> = {
  win: { title: "A recent win", angle: "Tell the story behind it: what you did, what happened and what others can reuse." },
  lesson: { title: "A lesson I learned", angle: "Share the lesson, the moment you learned it and what you do differently now." },
  question: { title: "An open question", angle: "Ask your network this question and share your current thinking." },
};
function experienceIdeas(strategy: ContentStrategy, checkins: readonly CheckinInput[], currentWeek: string): TopicIdea[] {
  return [...checkins].sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1)).slice(0, 8).flatMap(checkin => {
    const weeksAgo = Math.max(0, Math.floor(daysBetween(checkin.weekStart, currentWeek) / 7));
    return CHECKIN_FIELDS.flatMap(field => {
      const answer = checkin.answers[field]?.trim();
      if (!answer) return [];
      const pillar = matchPillar(answer, strategy.pillars);
      return [{
        id: ideaId("experience", `${checkin.weekStart}:${field}`, "story"), kind: "experience" as const, pillar,
        title: clip(`${EXPERIENCE[field].title}: ${answer}`, 120), angle: EXPERIENCE[field].angle,
        why: `From your weekly check-in for the week of ${shortDate(checkin.weekStart)}. Your own experience is what makes a post worth reading.`,
        score: round(0.8 - 0.04 * weeksAgo + (pillar ? 0.05 : 0)),
      }];
    });
  });
}

function followUpIdeas(strategy: ContentStrategy, published: readonly PublishedInput[], now: Date, timeZone: string): TopicIdea[] {
  return [...published]
    .filter(post => Number.isFinite(Date.parse(post.publishedAt)) && post.content.trim())
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || (a.id < b.id ? -1 : 1))
    .filter(post => { const age = now.getTime() - Date.parse(post.publishedAt); return age >= 2 * 86_400_000 && age <= 60 * 86_400_000; })
    .slice(0, 5)
    .flatMap(post => {
      const line = clip(post.content.trim().split(/\n+/)[0] ?? "", 80);
      const days = (now.getTime() - Date.parse(post.publishedAt)) / 86_400_000;
      const pillar = matchPillar(post.content, strategy.pillars);
      const why = `You posted this on ${shortDate(zonedParts(new Date(post.publishedAt), timeZone).date)}. A follow-up continues the conversation with the same readers.`;
      const timely = days >= 7 && days <= 30 ? 0.1 : 0;
      return [
        { id: ideaId("follow-up", post.id, "what-happened"), kind: "follow-up" as const, pillar, why,
          title: clip(`Follow-up: what happened after “${line}”`, 200), angle: "Share what changed since you posted it, with one concrete result or reply.",
          score: round(0.5 + timely + (pillar ? 0.05 : 0)) },
        { id: ideaId("follow-up", post.id, "go-deeper"), kind: "follow-up" as const, pillar, why,
          title: clip(`Going deeper on “${line}”`, 200), angle: "Pick one point from that post and expand it with an example.",
          score: round(0.45 + timely + (pillar ? 0.05 : 0)) },
      ];
    });
}

/** Every candidate idea (unranked, unique ids) from the strategy and the person's own data. */
export function generateIdeas(inputs: IdeaInputs): TopicIdea[] {
  const timeZone = safeTimeZone(inputs.timeZone);
  const candidates = [
    ...pillarIdeas(inputs.strategy),
    ...signalIdeas(inputs.strategy, inputs.trends),
    ...storyIdeas(inputs.strategy, inputs.stories),
    ...experienceIdeas(inputs.strategy, inputs.checkins, weekStartOf(inputs.now, timeZone)),
    ...followUpIdeas(inputs.strategy, inputs.published, inputs.now, timeZone),
  ];
  const seen = new Set<string>();
  return candidates.filter(idea => !seen.has(idea.id) && seen.add(idea.id));
}

const byScore = (a: TopicIdea, b: TopicIdea) => b.score - a.score || (a.id < b.id ? -1 : 1);

/** Greedy pick: each idea's score drops for every idea already picked with the same pillar or kind. */
export function diversify<T extends TopicIdea>(ideas: readonly T[], limit: number): T[] {
  const pool = [...ideas].sort(byScore);
  const picked: T[] = [];
  const pillars = new Map<string, number>();
  const kinds = new Map<string, number>();
  const pillarKey = (idea: TopicIdea) => idea.pillar?.toLowerCase() ?? "";
  while (picked.length < limit && pool.length) {
    let best = 0;
    let bestScore = -Infinity;
    pool.forEach((idea, index) => {
      const adjusted = idea.score - 0.08 * (pillars.get(pillarKey(idea)) ?? 0) - 0.05 * (kinds.get(idea.kind) ?? 0);
      if (adjusted > bestScore + 1e-9) { best = index; bestScore = adjusted; }
    });
    const [idea] = pool.splice(best, 1);
    picked.push(idea);
    pillars.set(pillarKey(idea), (pillars.get(pillarKey(idea)) ?? 0) + 1);
    kinds.set(idea.kind, (kinds.get(idea.kind) ?? 0) + 1);
  }
  return picked;
}

export interface StoredIdeaState { ideaId: string; state: IdeaState; idea: TopicIdea | null }

/**
 * Dismissed ideas never return; saved ideas are pinned first; drafted ("used") ideas stay visible but rank lower.
 * Saved and drafted ideas whose source is gone come back from their snapshot. The rest is diversified across
 * pillars and kinds.
 */
export function rankIdeas(candidates: readonly TopicIdea[], stored: readonly StoredIdeaState[], limit = IDEA_LIMIT): RankedIdea[] {
  const states = new Map(stored.map(entry => [entry.ideaId, entry]));
  const fresh = new Set(candidates.map(idea => idea.id));
  const stateOf = (id: string) => states.get(id)?.state ?? null;
  const snapshots = (state: IdeaState) => stored
    .filter(entry => entry.state === state && entry.idea && !fresh.has(entry.ideaId) && entry.idea.id === entry.ideaId).map(entry => entry.idea!);
  const saved: RankedIdea[] = [...candidates.filter(idea => stateOf(idea.id) === "saved"), ...snapshots("saved")]
    .sort(byScore).slice(0, MAX_SAVED_IDEAS).map(idea => ({ ...idea, state: "saved" as const }));
  const rest = [...candidates.filter(idea => stateOf(idea.id) === null || stateOf(idea.id) === "used"), ...snapshots("used")]
    .map(idea => stateOf(idea.id) === "used" ? { ...idea, score: round(idea.score / 2), state: "used" as const } : { ...idea, state: null });
  return [...saved, ...diversify(rest, Math.max(0, limit - saved.length))];
}

// ── Industry moments (Phase 5 contract, merged on the client) ─────────────

export const momentSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  date: z.string().regex(DATE_PATTERN),
  endDate: z.string().regex(DATE_PATTERN).nullable().optional().default(null),
  leadDays: z.number().int().min(0).max(120).catch(7),
  category: z.string().max(100).catch(""),
  url: z.string().max(2048).nullable().catch(null),
  description: z.string().max(2000).nullable().catch(null),
  suggestedAngle: z.string().max(500).catch(""),
  inLeadWindow: z.boolean().catch(false),
});
export type IndustryMoment = z.output<typeof momentSchema>;
/** Keeps only well-formed moments; anything else from an older or newer server is ignored. */
export function parseMoments(value: unknown): IndustryMoment[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).flatMap(entry => { const parsed = momentSchema.safeParse(entry); return parsed.success ? [parsed.data] : []; });
}

/** Moments can be fetched at most this many days at a time (Phase 5 window). */
export const MOMENT_FETCH_DAYS = 120;
export const momentIdeaId = (moment: Pick<IndustryMoment, "id">) => ideaId("moment", moment.id, "lead");

function momentIdea(moment: IndustryMoment, strategy: ContentStrategy): TopicIdea {
  const pillar = matchPillar(`${moment.title} ${moment.category} ${moment.description ?? ""}`, strategy.pillars);
  const when = moment.inLeadWindow ? "Now is a good time to post about it." : `Start drafting ${moment.leadDays} days ahead.`;
  return {
    id: momentIdeaId(moment), kind: "moment", pillar, momentDate: moment.date,
    title: clip(moment.title, 200),
    angle: clip(moment.suggestedAngle.trim() || `What ${moment.title} means for ${audienceLabel(strategy)}.`, 200),
    why: clip(`${moment.title} is on ${shortDate(moment.date)}. ${when}`, 300),
    score: round(0.6 + (moment.inLeadWindow ? 0.2 : 0) + (pillar ? 0.05 : 0)),
  };
}

/** Ideas for moments that have not ended and start within 60 days. */
export function momentIdeas(moments: readonly IndustryMoment[], strategy: ContentStrategy, today: string): TopicIdea[] {
  return moments.filter(moment => (moment.endDate ?? moment.date) >= today && daysBetween(today, moment.date) <= 60).map(moment => momentIdea(moment, strategy));
}

/** Adds client-side moment ideas: dismissed ones are dropped, saved ones pinned, up to 3 others spread through the list. */
export function mergeMomentIdeas(response: Pick<IdeasResponse, "ideas" | "states">, moments: readonly TopicIdea[]): RankedIdea[] {
  const present = new Set(response.ideas.map(idea => idea.id));
  const extra = moments.filter(idea => !present.has(idea.id) && response.states[idea.id] !== "dismissed")
    .map((idea): RankedIdea => ({ ...idea, state: response.states[idea.id] === "saved" ? "saved" : response.states[idea.id] === "used" ? "used" : null }));
  const pinned = [...response.ideas.filter(idea => idea.state === "saved"), ...extra.filter(idea => idea.state === "saved")];
  const rest = response.ideas.filter(idea => idea.state !== "saved");
  [...extra].filter(idea => idea.state !== "saved").sort(byScore).slice(0, 3)
    .forEach((idea, index) => rest.splice(Math.min(rest.length, 1 + index * 3), 0, idea));
  return [...pinned, ...rest];
}

// ── 30-day plan ───────────────────────────────────────────────────────────

export const PLAN_DEFAULT_DAYS = 30;
export const PLAN_MAX_DAYS = 60;
export const planQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(PLAN_MAX_DAYS).default(PLAN_DEFAULT_DAYS),
  extra: extraIdeaIdsSchema,
});

const DEFAULT_WEEKDAYS: Record<number, number[]> = { 1: [2], 2: [2, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
const mondayFirst = (slot: PostingSlot) => `${(slot.weekday + 6) % 7}${slot.time}`;

/**
 * Exactly `postsPerWeek` posting times: chosen times spread evenly when there are more of them,
 * topped up with usual posting days at the preferred time when there are fewer.
 */
export function effectiveSlots(cadence: ContentStrategy["cadence"], fallbackTime: string): PostingSlot[] {
  const count = Math.max(1, Math.min(7, cadence.postsPerWeek));
  const chosen = [...cadence.slots].sort((a, b) => (mondayFirst(a) < mondayFirst(b) ? -1 : 1));
  if (chosen.length >= count) return Array.from({ length: count }, (_, index) => chosen[Math.floor(index * chosen.length / count)]);
  const used = new Set(chosen.map(slot => slot.weekday));
  const extra = [...DEFAULT_WEEKDAYS[count], ...[1, 2, 3, 4, 5, 6, 0]].filter((weekday, index, all) => !used.has(weekday) && all.indexOf(weekday) === index);
  const time = validTime(fallbackTime);
  return [...chosen, ...extra.slice(0, count - chosen.length).map(weekday => ({ weekday, time }))].sort((a, b) => (mondayFirst(a) < mondayFirst(b) ? -1 : 1));
}

export interface ScheduledInput { draftId: string; at: string; excerpt: string; status: string }
export type PlanEntry =
  | { kind: "scheduled"; key: string; date: string; time: string; at: string; post: { draftId: string; excerpt: string; status: string } }
  | { kind: "suggestion"; key: string; date: string; time: string; at: string; idea: RankedIdea }
  | { kind: "open"; key: string; date: string; time: string; at: string }
  | { kind: "moment"; key: string; date: string; time: null; at: null; moment: IndustryMoment; idea: TopicIdea };
export interface PlanResponse {
  timezone: string;
  from: string;
  /** Exclusive end date. */
  to: string;
  days: number;
  postsPerWeek: number;
  hasStrategy: boolean;
  entries: PlanEntry[];
  /** States of the requested `extra` ids (moments), so dismissed or drafted moments stay out of the plan. */
  states: Record<string, IdeaState>;
}
export interface PlanInputs {
  now: Date;
  days: number;
  timeZone: string;
  strategy: ContentStrategy;
  fallbackTime: string;
  hasStrategy: boolean;
  scheduled: readonly ScheduledInput[];
  /** Ranked ideas; dismissed and drafted ones are skipped. */
  ideas: readonly RankedIdea[];
  states?: Record<string, IdeaState>;
}

const entryOrder = (entry: PlanEntry) => `${entry.date} ${entry.kind === "moment" ? "0" : `1${entry.at}`} ${entry.key}`;
export const sortPlanEntries = (entries: readonly PlanEntry[]) => [...entries].sort((a, b) => (entryOrder(a) < entryOrder(b) ? -1 : 1));

/**
 * Upcoming posting slots in the person's time zone. Scheduled posts are shown as they are (never changed) and take
 * the nearest slot that day; each week keeps at most `postsPerWeek` entries; remaining slots get ideas rotating
 * through the pillars with no idea repeated. Suggestions only: nothing is scheduled.
 */
export function buildPlan(input: PlanInputs): PlanResponse {
  const timeZone = safeTimeZone(input.timeZone);
  const days = Math.max(1, Math.min(PLAN_MAX_DAYS, Math.floor(input.days)));
  const from = zonedParts(input.now, timeZone).date;
  const to = addDays(from, days);
  const nowMs = input.now.getTime();
  const endMs = zonedTimeToUtc(to, "00:00", timeZone).getTime();
  const slots = effectiveSlots(input.strategy.cadence, input.fallbackTime);

  const posts = input.scheduled
    .map(post => ({ ...post, ms: Date.parse(post.at) }))
    .filter(post => Number.isFinite(post.ms) && post.ms >= nowMs && post.ms < endMs)
    .sort((a, b) => a.ms - b.ms || (a.draftId < b.draftId ? -1 : 1));
  const open: Array<{ date: string; time: string; ms: number }> = [];
  for (let offset = 0; offset < days; offset++) {
    const date = addDays(from, offset);
    for (const slot of slots.filter(slot => slot.weekday === weekdayOf(date))) {
      const ms = zonedTimeToUtc(date, slot.time, timeZone).getTime();
      if (ms > nowMs && ms < endMs) open.push({ date, time: slot.time, ms });
    }
  }

  const entries: PlanEntry[] = posts.map(post => {
    const local = zonedParts(new Date(post.ms), timeZone);
    const sameDay = open.filter(slot => slot.date === local.date).sort((a, b) => Math.abs(a.ms - post.ms) - Math.abs(b.ms - post.ms))[0];
    if (sameDay) open.splice(open.indexOf(sameDay), 1);
    return { kind: "scheduled", key: `post:${post.draftId}`, date: local.date, time: local.time, at: new Date(post.ms).toISOString(),
      post: { draftId: post.draftId, excerpt: clip(post.excerpt, 140), status: post.status } };
  });

  const perWeek = new Map<string, number>();
  for (const entry of entries) perWeek.set(mondayOf(entry.date), (perWeek.get(mondayOf(entry.date)) ?? 0) + 1);
  const available = input.ideas.filter(idea => idea.state !== "used");
  const usedIds = new Set<string>();
  const pillars = input.strategy.pillars.map(pillar => pillar.name.toLowerCase());
  let rotation = 0;
  let previous: string | null = null;
  for (const slot of open.sort((a, b) => a.ms - b.ms)) {
    const week = mondayOf(slot.date);
    if ((perWeek.get(week) ?? 0) >= slots.length) continue;
    perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
    const target = pillars.length ? pillars[rotation++ % pillars.length] : null;
    const unused = available.filter(idea => !usedIds.has(idea.id));
    const idea = unused.find(candidate => target !== null && candidate.pillar?.toLowerCase() === target)
      ?? unused.find(candidate => (candidate.pillar?.toLowerCase() ?? null) !== previous)
      ?? unused[0];
    const base = { key: `slot:${new Date(slot.ms).toISOString()}`, date: slot.date, time: slot.time, at: new Date(slot.ms).toISOString() };
    if (idea) { usedIds.add(idea.id); previous = idea.pillar?.toLowerCase() ?? null; entries.push({ ...base, kind: "suggestion", idea }); }
    else entries.push({ ...base, kind: "open" });
  }

  return { timezone: timeZone, from, to, days, postsPerWeek: slots.length, hasStrategy: input.hasStrategy, entries: sortPlanEntries(entries), states: input.states ?? {} };
}

/** Moments shown at the start of their lead window (or today if it has begun), within the plan's dates. */
export function placeMoments(plan: Pick<PlanResponse, "from" | "to" | "entries" | "states">, moments: readonly IndustryMoment[], strategy: ContentStrategy): PlanEntry[] {
  const placed = moments.flatMap((moment): PlanEntry[] => {
    const state = plan.states?.[momentIdeaId(moment)];
    if ((moment.endDate ?? moment.date) < plan.from || state === "dismissed" || state === "used") return [];
    const idea = momentIdea(moment, strategy);
    const start = addDays(moment.date, -moment.leadDays);
    const date = start < plan.from ? plan.from : start;
    return date < plan.to ? [{ kind: "moment", key: `moment:${moment.id}`, date, time: null, at: null, moment, idea }] : [];
  });
  return sortPlanEntries([...plan.entries.filter(entry => entry.kind !== "moment"), ...placed]);
}

/** Agenda weeks starting on Monday, in date order. */
export function groupPlanByWeek(entries: readonly PlanEntry[]): Array<{ weekStart: string; entries: PlanEntry[] }> {
  const weeks = new Map<string, PlanEntry[]>();
  for (const entry of sortPlanEntries(entries)) {
    const week = mondayOf(entry.date);
    weeks.set(week, [...(weeks.get(week) ?? []), entry]);
  }
  return [...weeks.entries()].map(([weekStart, list]) => ({ weekStart, entries: list }));
}
