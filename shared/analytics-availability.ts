import { z } from "zod";

export const ANALYTICS_FIELDS = ["followers", "following", "posts", "impressions", "engagements", "engagementRate", "likes", "comments", "shares", "clicks", "profileViews"] as const;
export type AnalyticsField = typeof ANALYTICS_FIELDS[number];
export type AnalyticsMetrics = Record<AnalyticsField, number | null>;
export const ANALYTICS_REASONS = ["unsupported", "not_connected", "no_snapshot", "legacy_unverified", "invalid_metric", "invalid_timestamp", "invalid_provenance", "fetch_failed", "account_mismatch", "partial_coverage", "incompatible_coverage", "not_additive"] as const;
export type AnalyticsReason = typeof ANALYTICS_REASONS[number];
export interface MetricAvailability {
  status: "measured" | "unavailable";
  reason: AnalyticsReason | null;
  supported: boolean;
  measuredAt: string | null;
  source: "provider_response" | null;
  endpoint: string | null;
  sourceField: string | null;
  /** null = account snapshot; a period is inclusive start, exclusive end. */
  period: { start: string; end: string } | null;
}
export type AnalyticsAvailability = Record<AnalyticsField, MetricAvailability>;
export interface AvailableAnalytics {
  metrics: AnalyticsMetrics;
  availability: AnalyticsAvailability;
  supportedFields: AnalyticsField[];
}

const instantSchema = z.string().datetime({ offset: true });
/** Never interpret timezone-less strings in the server/browser's local zone. */
export function analyticsInstant(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (!instantSchema.safeParse(value).success) return null;
  const date = new Date(value as string);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function unavailable(reason: AnalyticsReason, supported = false): MetricAvailability {
  return { status: "unavailable", reason, supported, measuredAt: null, source: null, endpoint: null, sourceField: null, period: null };
}

export function unavailableAnalytics(reason: AnalyticsReason): AvailableAnalytics {
  return {
    metrics: Object.fromEntries(ANALYTICS_FIELDS.map(field => [field, null])) as AnalyticsMetrics,
    availability: Object.fromEntries(ANALYTICS_FIELDS.map(field => [field, unavailable(reason)])) as AnalyticsAvailability,
    supportedFields: [],
  };
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const evidenceSchema = z.object({
  status: z.enum(["measured", "unavailable"]),
  reason: z.enum(ANALYTICS_REASONS).nullable(),
  supported: z.boolean(),
  measuredAt: z.string().nullable(),
  source: z.literal("provider_response").nullable(),
  endpoint: z.string().trim().min(1).max(300).nullable(),
  sourceField: z.string().trim().min(1).max(100).nullable(),
  period: z.object({ start: z.string(), end: z.string() }).nullable(),
});

function validMetric(field: AnalyticsField, value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return false;
  return field === "engagementRate" ? value <= 100 : Number.isSafeInteger(value);
}

function measurementTime(item: MetricAvailability, now: Date) {
  const measuredAt = analyticsInstant(item.measuredAt);
  if (!measuredAt || measuredAt > now.toISOString()) return null;
  if (!item.period) return { measuredAt, period: null };
  const start = analyticsInstant(item.period.start);
  const end = analyticsInstant(item.period.end);
  if (!start || !end || start >= end || end > measuredAt) return null;
  return { measuredAt, period: { start, end } };
}

function normalizeField(field: AnalyticsField, value: unknown, evidence: unknown, now: Date): { value: number | null; availability: MetricAvailability } {
  const parsed = evidenceSchema.safeParse(evidence);
  if (!parsed.success) return { value: null, availability: unavailable("invalid_provenance") };
  const item = parsed.data;
  if (item.status === "unavailable") return { value: null, availability: unavailable(item.reason ?? "invalid_provenance", item.supported) };
  if (!item.supported || item.reason !== null || item.source !== "provider_response" || !item.endpoint || !item.sourceField) {
    return { value: null, availability: unavailable("invalid_provenance", item.supported) };
  }
  const time = measurementTime(item, now);
  if (!time) return { value: null, availability: unavailable("invalid_timestamp", true) };
  if (!validMetric(field, value)) return { value: null, availability: unavailable("invalid_metric", true) };
  return { value, availability: { ...item, ...time } };
}

/** Read-time compatibility boundary. Numbers alone, including old zeroes, are not evidence. */
export function normalizeAnalytics(snapshot: unknown, now = new Date()): AvailableAnalytics {
  if (!snapshot) return unavailableAnalytics("no_snapshot");
  const row = object(snapshot);
  const values = object(row.metrics);
  const evidence = object(row.metricAvailability);
  const result = unavailableAnalytics("legacy_unverified");
  for (const field of ANALYTICS_FIELDS) {
    if (!Object.hasOwn(evidence, field)) continue;
    const normalized = normalizeField(field, values[field], evidence[field], now);
    if (normalized.availability.supported) result.supportedFields.push(field);
    result.metrics[field] = normalized.value;
    result.availability[field] = normalized.availability;
  }
  return result;
}

export interface AggregateMetric {
  status: "measured" | "unavailable";
  reason: AnalyticsReason | null;
  /** Oldest contributing measurement, not the time the summary was requested. */
  measuredAt: string | null;
  coverage: { expectedAccounts: number; measuredAccounts: number; measuredFrom: string | null; measuredThrough: string | null };
}

function aggregateReason(field: AnalyticsField, expected: number, known: AvailableAnalytics[], sum: number): AnalyticsReason | null {
  if (expected === 0) return "not_connected";
  if (known.length !== expected) return "partial_coverage";
  if (new Set(known.map(account => JSON.stringify(account.availability[field].period))).size > 1) return "incompatible_coverage";
  if (field === "engagementRate" && expected > 1) return "not_additive";
  return validMetric(field, sum) ? null : "invalid_metric";
}

/** No partial sum is labelled a total; rates are never summed or inferred from followers. */
export function combineAnalytics(accounts: AvailableAnalytics[]) {
  const metrics = unavailableAnalytics("not_connected").metrics;
  const availability = {} as Record<AnalyticsField, AggregateMetric>;
  for (const field of ANALYTICS_FIELDS) {
    const known = accounts.filter(account => account.metrics[field] !== null && account.availability[field].status === "measured");
    const dates = known.map(account => account.availability[field].measuredAt!).sort((a, b) => a.localeCompare(b));
    const sum = known.reduce((total, account) => total + account.metrics[field]!, 0);
    const reason = aggregateReason(field, accounts.length, known, sum);
    if (!reason) metrics[field] = sum;
    availability[field] = {
      status: reason ? "unavailable" : "measured", reason,
      measuredAt: reason ? null : dates[0],
      coverage: { expectedAccounts: accounts.length, measuredAccounts: known.length, measuredFrom: dates[0] ?? null, measuredThrough: dates.at(-1) ?? null },
    };
  }
  return { metrics, availability };
}

export interface AnalyticsProviderSummary extends AvailableAnalytics {
  account: { id: string; name: string | null; handle: string | null; lastSync: string | null };
  snapshotDate: string | null;
  // No adapter currently verifies post-level metrics. Legacy topPosts must not escape.
  topPosts: null;
}
export interface AnalyticsSummary {
  connected: { linkedin: boolean; twitter: boolean };
  combined: AnalyticsMetrics;
  availability: Record<AnalyticsField, AggregateMetric>;
  linkedin: AnalyticsProviderSummary | null;
  twitter: AnalyticsProviderSummary | null;
  lastSync: string | null;
}

const aggregateSchema = z.object({
  status: z.enum(["measured", "unavailable"]), reason: z.enum(ANALYTICS_REASONS).nullable(), measuredAt: z.string().nullable(),
  coverage: z.object({ expectedAccounts: z.number().int().nonnegative(), measuredAccounts: z.number().int().nonnegative(),
    measuredFrom: z.string().nullable(), measuredThrough: z.string().nullable() }),
});

/** UI boundary: malformed or old API results must not turn into numeric tiles. */
export function analyticsDisplayMetric(field: AnalyticsField, value: unknown, metadata: unknown, now = new Date()) {
  const parsed = aggregateSchema.safeParse(metadata);
  const fallback = { value: null, measuredAt: null, reason: "invalid_provenance", coverage: null } as const;
  if (!parsed.success) return fallback;
  const info = parsed.data;
  const { expectedAccounts, measuredAccounts } = info.coverage;
  if (measuredAccounts > expectedAccounts) return fallback;
  if (info.status !== "measured") return { ...fallback, reason: info.reason ?? "invalid_provenance", coverage: info.coverage };
  const measuredAt = analyticsInstant(info.measuredAt);
  const from = analyticsInstant(info.coverage.measuredFrom);
  const through = analyticsInstant(info.coverage.measuredThrough);
  if (info.reason !== null || !expectedAccounts || expectedAccounts !== measuredAccounts || !measuredAt || !from || !through ||
      measuredAt !== from || from > through || through > now.toISOString()) return fallback;
  if (!validMetric(field, value)) return fallback;
  return { value, measuredAt, reason: null, coverage: info.coverage };
}