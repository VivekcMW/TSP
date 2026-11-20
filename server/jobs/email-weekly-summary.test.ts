import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { emailPreferenceDefaults } from "@shared/email-preferences";
const m = vi.hoisted(() => ({ execute: vi.fn(), recipient: vi.fn(), preferences: vi.fn(), send: vi.fn(), load: vi.fn() }));
vi.mock("../db", () => ({ db: {
  select: () => ({ from: () => ({ innerJoin: () => ({ innerJoin: () => ({ where: () => ({ limit: m.recipient }) }) }) }) }),
  transaction: async (work: (tx: { execute: typeof m.execute }) => Promise<unknown>) => work({ execute: m.execute }),
} }));
vi.mock("../services/email", async () => ({ deliverAppEmail: m.send, emailTemplates: (await import("../services/email/templates")).emailTemplates }));
vi.mock("../services/email/preferences", () => ({ getEmailPreferences: m.preferences }));
import { loadWeeklySummary, sendWeeklySummaryForScope, weeklySummaryWindow } from "./email-weekly-summary";

const scope = { tenantId: "tenant", userId: "user" };
const now = new Date("2026-10-26T10:00:00Z");
const deps = { getEmailPreferences: m.preferences, loadWeeklySummary: m.load, deliverAppEmail: m.send };
beforeEach(() => {
  vi.clearAllMocks();
  m.preferences.mockResolvedValue({ ...emailPreferenceDefaults, weeklySummary: true });
  m.load.mockResolvedValue({ email: "reader@example.invalid", name: "Reader", workspace: "Workspace", articles: 12, drafts: 4, published: 2 });
  m.recipient.mockResolvedValue([{ email: "reader@example.invalid", name: "Reader", workspace: "Workspace" }]);
  m.execute.mockResolvedValue({ rows: [{ articles: 12, drafts: 4, published: 2 }] });
});
describe("weekly summary window", () => {
  it("is due only on local Monday at or after the configured time", () => {
    expect(weeklySummaryWindow(now, "UTC", "09:00")).toEqual({ slot: "2026-10-26", weekStart: "2026-10-19", weekEnd: "2026-10-25" });
    expect(weeklySummaryWindow(new Date("2026-10-26T08:59:59Z"), "UTC", "09:00")).toBeUndefined();
    expect(weeklySummaryWindow(new Date("2026-10-27T10:00:00Z"), "UTC", "09:00")).toBeUndefined();
    expect(weeklySummaryWindow(new Date("2026-10-25T23:30:00Z"), "Asia/Kolkata", "05:00")?.slot).toBe("2026-10-26");
    expect(weeklySummaryWindow(new Date("2026-10-26T00:30:00Z"), "America/New_York", "09:00")).toBeUndefined();
  });
  it("uses local calendar dates across DST changes and year boundaries", () => {
    expect(weeklySummaryWindow(new Date("2026-11-02T14:00:00Z"), "America/New_York", "09:00")).toEqual({
      slot: "2026-11-02", weekStart: "2026-10-26", weekEnd: "2026-11-01",
    });
    expect(weeklySummaryWindow(new Date("2027-01-04T10:00:00Z"), "UTC", "09:00")?.weekStart).toBe("2026-12-28");
  });
  it.each([["invalid", "09:00"], ["UTC", "25:00"]])("rejects an invalid window %s %s", (zone, time) => {
    expect(weeklySummaryWindow(now, zone, time)).toBeUndefined();
  });
});
describe("weekly summary binding", () => {
  it("loads and emails only the previous Monday–Sunday with stable workspace/user/week identity", async () => {
    await sendWeeklySummaryForScope(scope, now, deps);
    expect(m.load).toHaveBeenCalledWith(scope, "2026-10-19", "2026-10-26", "UTC");
    expect(m.send).toHaveBeenCalledWith(expect.objectContaining({
      type: "weekly_summary", recipient: "reader@example.invalid", userId: "user",
      dedupeKey: '["weekly-summary-v1","tenant","user","2026-10-26"]',
    }));
    expect(m.send.mock.calls[0][0].text).toContain("Confirmed published posts: 2");
  });
  it("is independent of daily digest, but honors weekly opt-out and global unsubscribe", async () => {
    m.preferences.mockResolvedValueOnce({ ...emailPreferenceDefaults, weeklySummary: true, dailyDigest: false });
    await sendWeeklySummaryForScope(scope, now, deps);
    expect(m.send).toHaveBeenCalledOnce();
    m.send.mockClear(); m.load.mockClear();
    m.preferences.mockResolvedValueOnce({ ...emailPreferenceDefaults, weeklySummary: false })
      .mockResolvedValueOnce({ ...emailPreferenceDefaults, weeklySummary: true, unsubscribedAt: now });
    await sendWeeklySummaryForScope(scope, now, deps); await sendWeeklySummaryForScope(scope, now, deps);
    expect(m.load).not.toHaveBeenCalled(); expect(m.send).not.toHaveBeenCalled();
  });
  it("sends truthful zero activity instead of inventing activity", async () => {
    m.load.mockResolvedValue({ email: "reader@example.invalid", name: "Reader", workspace: "Workspace", articles: 0, drafts: 0, published: 0 });
    await sendWeeklySummaryForScope(scope, now, deps);
    expect(m.send.mock.calls[0][0].text).toContain("Articles discovered: 0");
  });
  it("does not send without a verified active membership and propagates read failures", async () => {
    m.load.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("counts unavailable"));
    await sendWeeklySummaryForScope(scope, now, deps);
    await expect(sendWeeklySummaryForScope(scope, now, deps)).rejects.toThrow("counts unavailable");
    expect(m.send).not.toHaveBeenCalled();
  });
  it("aggregates under tenant RLS and excludes simulation, manual/unverified and duplicate platform receipts", async () => {
    await expect(loadWeeklySummary(scope, "2026-10-19", "2026-10-26", "America/New_York")).resolves.toMatchObject({ articles: 12, drafts: 4, published: 2 });
    const dialect = new PgDialect();
    expect(dialect.sqlToQuery(m.execute.mock.calls[0][0]).sql).toContain("set_config('app.tenant_id'");
    const query = dialect.sqlToQuery(m.execute.mock.calls[1][0]);
    expect(query.sql).toContain("count(distinct d.id)");
    expect(query.sql).toContain("t.execution_mode = 'live'");
    expect(query.sql).toContain("t.receipt_kind = 'provider_id'");
    expect(query.sql).toContain("nullif(trim(t.provider_post_id), '') is not null");
    expect(query.sql).toContain("!~* '^(sandbox|mock|dryrun|dry-run)[_-]'");
    expect(query.sql).toContain("at time zone 'UTC'");
    expect(query.params).toContain("America/New_York");
    expect(query.params).toContain("2026-10-19"); expect(query.params).toContain("2026-10-26");
  });
});
