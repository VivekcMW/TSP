import { z } from "zod";

/** Industry moments (Phase 5): global, admin-curated dates people may want to post about. */
export const MOMENT_REGIONS = ["global", "US", "UK", "EU", "IN", "AU", "CA", "BR", "JP"] as const;
export type MomentRegion = typeof MOMENT_REGIONS[number];
export const MOMENT_REGION_LABELS: Record<MomentRegion, string> = {
  global: "Global", US: "United States", UK: "United Kingdom", EU: "European Union", IN: "India",
  AU: "Australia", CA: "Canada", BR: "Brazil", JP: "Japan",
};
/** Matches every profile. */
export const MOMENT_TAG_ALL = "all";
export const MOMENT_TITLE_MAX = 120;
export const MOMENT_DESCRIPTION_MAX = 500;
export const MOMENT_TAGS_MAX = 10;
export const MOMENT_TAG_MAX = 40;
export const MOMENT_LEAD_DAYS = { min: 1, max: 90, default: 14 } as const;
export const MOMENT_FILTERS = ["upcoming", "past", "archived"] as const;
export type MomentFilter = typeof MOMENT_FILTERS[number];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export const isoDateSchema = z.string().regex(DATE, "Use YYYY-MM-DD").refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Use a real date");

const tagSchema = z.string().trim().toLowerCase().min(1).max(MOMENT_TAG_MAX)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} &+.'-]*$/u, "Tags use letters, numbers, spaces and & + . ' -");
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional()
  .transform(value => value ? value : null);

export const momentInputSchema = z.object({
  title: z.string().trim().min(1, "Add a title").max(MOMENT_TITLE_MAX),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema.nullable().optional().transform(value => value ?? null),
  region: z.enum(MOMENT_REGIONS).default("global"),
  tags: z.array(tagSchema).max(MOMENT_TAGS_MAX, `Use at most ${MOMENT_TAGS_MAX} tags`).default([])
    .transform(tags => [...new Set(tags)]),
  leadDays: z.number().int().min(MOMENT_LEAD_DAYS.min).max(MOMENT_LEAD_DAYS.max).default(MOMENT_LEAD_DAYS.default),
  url: optionalText(2048).refine(value => {
    if (!value) return true;
    try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }
    catch { return false; }
  }, "Use an http or https link"),
  description: optionalText(MOMENT_DESCRIPTION_MAX),
}).strict().refine(value => !value.endsOn || value.endsOn >= value.startsOn, { message: "End date must be on or after the start date", path: ["endsOn"] });
export type MomentInput = z.output<typeof momentInputSchema>;

/** GET /api/moments item (the cross-phase contract). */
export interface MomentView {
  id: string;
  title: string;
  date: string;
  endDate: string | null;
  leadDays: number;
  category: string;
  url: string | null;
  description: string | null;
  suggestedAngle: string;
  inLeadWindow: boolean;
}

/** Admin list/create/update response row. */
export interface AdminMoment {
  id: string;
  title: string;
  startsOn: string;
  endsOn: string | null;
  region: MomentRegion;
  tags: string[];
  leadDays: number;
  url: string | null;
  description: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Watchlist (GET/PUT /api/watchlist). Terms are chosen from the person's profile. */
export const WATCH_TERM_KINDS = ["company", "person", "topic"] as const;
export const WATCHLIST_MAX = 30;
export const watchTermSchema = z.object({
  kind: z.enum(WATCH_TERM_KINDS),
  term: z.string().trim().min(1).max(80),
}).strict();
export const watchlistInputSchema = z.object({ terms: z.array(watchTermSchema).max(WATCHLIST_MAX) }).strict();
export interface WatchlistView {
  terms: Array<z.infer<typeof watchTermSchema>>;
  options: Array<z.infer<typeof watchTermSchema>>;
}

/** GET /api/watch-alerts item. */
export interface WatchAlertView {
  id: string;
  inboxItemId: string;
  term: string;
  kind: typeof WATCH_TERM_KINDS[number];
  headline: string;
  source: string;
  articleUrl: string;
  createdAt: string;
  seenAt: string | null;
}
