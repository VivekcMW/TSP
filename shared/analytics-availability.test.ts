import { describe, expect, it } from "vitest";
import { ANALYTICS_FIELDS, analyticsDisplayMetric, analyticsInstant, combineAnalytics, normalizeAnalytics, unavailableAnalytics, type AnalyticsField, type MetricAvailability } from "./analytics-availability";

const now = new Date("2026-09-19T12:00:00Z");
const evidence: MetricAvailability = { status: "measured", reason: null, supported: true, measuredAt: "2026-09-18T12:00:00Z", source: "provider_response", endpoint: "/verified-test-endpoint", sourceField: "test_count", period: null };
function measured(value: unknown = 0, field: AnalyticsField = "impressions", patch: Partial<MetricAvailability> = {}) {
  return normalizeAnalytics({ metrics: { [field]: value }, metricAvailability: { [field]: { ...evidence, ...patch } } }, now);
}

describe("analytics availability contract", () => {
  it("marks all legacy values unknown, even nonzero and dated snapshots", () => {
    const result = normalizeAnalytics({ metrics: { impressions: 0, followers: 1234 }, snapshotDate: now });
    expect(Object.values(result.metrics)).toEqual(ANALYTICS_FIELDS.map(() => null));
    expect(result.availability.impressions).toMatchObject({ reason: "legacy_unverified", measuredAt: null });
  });
  it("keeps genuine measured zero separate from missing fields", () => {
    const result = measured();
    expect(result.metrics.impressions).toBe(0);
    expect(result.metrics.engagements).toBeNull();
    expect(result.supportedFields).toEqual(["impressions"]);
    expect(result.availability.impressions.measuredAt).toBe("2026-09-18T12:00:00.000Z");
  });
  it.each([null, undefined, "0", "12", -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid count %s", value => {
    // undefined must remain absent rather than activate the fixture's default parameter.
    const result = normalizeAnalytics({ metrics: { impressions: value }, metricAvailability: { impressions: evidence } }, now);
    expect(result.metrics.impressions).toBeNull();
    expect(result.availability.impressions.reason).toBe("invalid_metric");
  });
  it.each([null, {}, [], { metrics: [] }, { metrics: { impressions: 0 }, metricAvailability: { impressions: null } }])("handles malformed snapshot %j", row => {
    expect(() => normalizeAnalytics(row, now)).not.toThrow();
    expect(normalizeAnalytics(row, now).metrics.impressions).toBeNull();
  });
  it.each([null, "", "invalid", "2026-09-18", "2026-09-18T12:00:00", "2026-02-30T00:00:00Z", "2026-09-20T00:00:00Z"])("rejects invalid measurement time %s", measuredAt => {
    expect(measured(0, "impressions", { measuredAt }).availability.impressions.reason).toBe("invalid_timestamp");
  });
  it("normalizes offset instants without local timezone reinterpretation", () => {
    expect(analyticsInstant("2026-09-19T00:30:00+05:30")).toBe("2026-09-18T19:00:00.000Z");
    expect(analyticsInstant(new Date("bad"))).toBeNull();
    expect(analyticsInstant(0)).toBeNull();
  });
  it.each([{ source: null }, { endpoint: null }, { sourceField: null }, { supported: false }, { reason: "unsupported" as const }])("requires complete provenance %j", patch => {
    expect(measured(0, "impressions", patch).availability.impressions.reason).toBe("invalid_provenance");
  });
  it("does not promote unsupported numeric payloads", () => {
    const result = measured(0, "impressions", { status: "unavailable", reason: "unsupported", supported: false });
    expect(result.metrics.impressions).toBeNull();
    expect(result.availability.impressions.measuredAt).toBeNull();
  });
  it.each([{ start: "2026-09-19T00:00:00Z", end: "2026-09-18T00:00:00Z" }, { start: "bad", end: "2026-09-18T00:00:00Z" }, { start: "2026-09-17T00:00:00Z", end: "2026-09-19T00:00:00Z" }])("rejects invalid measurement period %j", period => {
    expect(measured(0, "impressions", { period }).availability.impressions.reason).toBe("invalid_timestamp");
  });
  it("does not calculate engagement from followers or undefined denominators", () => {
    const combined = combineAnalytics([measured(100, "followers")]);
    expect(combined.metrics.followers).toBe(100);
    expect(combined.metrics.engagements).toBeNull();
    expect(combined.metrics.engagementRate).toBeNull();
  });
  it("reports no-connection and partial-coverage totals as null", () => {
    expect(combineAnalytics([]).availability.impressions).toMatchObject({ reason: "not_connected", coverage: { expectedAccounts: 0, measuredAccounts: 0 } });
    const combined = combineAnalytics([measured(0), unavailableAnalytics("fetch_failed")]);
    expect(combined.metrics.impressions).toBeNull();
    expect(combined.availability.impressions).toMatchObject({ reason: "partial_coverage", measuredAt: null, coverage: { expectedAccounts: 2, measuredAccounts: 1 } });
  });
  it("sums complete count coverage including measured zero with oldest timestamp", () => {
    const combined = combineAnalytics([measured(0), measured(12, "impressions", { measuredAt: "2026-09-17T23:00:00-02:00" })]);
    expect(combined.metrics.impressions).toBe(12);
    expect(combined.availability.impressions).toMatchObject({ measuredAt: "2026-09-18T01:00:00.000Z", coverage: { expectedAccounts: 2, measuredAccounts: 2, measuredThrough: "2026-09-18T12:00:00.000Z" } });
  });
  it("does not combine incompatible periods or average rates", () => {
    expect(combineAnalytics([measured(0), measured(5, "impressions", { period: { start: "2026-09-16T00:00:00Z", end: "2026-09-17T00:00:00Z" } })]).availability.impressions.reason).toBe("incompatible_coverage");
    expect(combineAnalytics([measured(0, "engagementRate"), measured(10, "engagementRate")]).availability.engagementRate.reason).toBe("not_additive");
    expect(combineAnalytics([measured(0, "engagementRate")]).metrics.engagementRate).toBe(0);
    expect(measured(101, "engagementRate").metrics.engagementRate).toBeNull();
  });
  it("refuses unsafe sum overflow", () => {
    expect(combineAnalytics([measured(Number.MAX_SAFE_INTEGER), measured(1)]).availability.impressions.reason).toBe("invalid_metric");
  });
  it("only displays validated complete measured metadata, preserving zero", () => {
    const info = combineAnalytics([measured()]).availability.impressions;
    expect(analyticsDisplayMetric("impressions", 0, info, now).value).toBe(0);
    expect(analyticsDisplayMetric("impressions", "0", info, now).value).toBeNull();
    expect(analyticsDisplayMetric("impressions", 0, {}, now).value).toBeNull();
    expect(analyticsDisplayMetric("impressions", 0, { ...info, measuredAt: "invalid" }, now).value).toBeNull();
    expect(analyticsDisplayMetric("impressions", 0, { ...info, coverage: { ...info.coverage, expectedAccounts: 2 } }, now).value).toBeNull();
  });
});