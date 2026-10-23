import { beforeEach, expect, it, vi } from "vitest";
import { emailPreferenceDefaults } from "@shared/email-preferences";
import { guardNotificationsMediaNetwork } from "../../test/notifications-media-network";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
const m = vi.hoisted(() => ({ preferences: vi.fn(), send: vi.fn(), template: vi.fn(), execute: vi.fn(), select: vi.fn(), where: vi.fn(), orderBy: vi.fn(), articleLimit: vi.fn(), scopes: vi.fn(), recover: vi.fn(), reminder: vi.fn() }));
vi.mock("../storage", () => ({ storage: { getSchedulerScopes: m.scopes } }));
vi.mock("../db", () => ({ db: {
  select: (fields: unknown) => { m.select(fields); return { from: () => ({ where: () => ({ limit: async () => [{ email: "test@example.invalid", name: "Arjun Mehta" }] }) }) }; },
  transaction: async (work: any) => work({ execute: m.execute,
    select: (fields: unknown) => { m.select(fields); return { from: () => ({ where: (predicate: unknown) => {
      m.where(predicate); return { orderBy: (...order: unknown[]) => { m.orderBy(...order); return { limit: m.articleLimit }; } };
    } }) }; } }),
} }));
vi.mock("../services/email/preferences", () => ({ getEmailPreferences: m.preferences }));
vi.mock("../services/email", () => ({ deliverAppEmail: m.send, emailTemplates: { dailyDigest: m.template } }));
vi.mock("../services/email/delivery-store", () => ({ recoverEmailDeliveries: m.recover }));
vi.mock("./email-reminders", () => ({ sendReminderForScope: m.reminder }));
import { runEmailDigestCycle, sendDigestForScope } from "./email-digest";
guardNotificationsMediaNetwork();
const scope = { tenantId: "tenant", userId: "user" };
beforeEach(() => {
  vi.clearAllMocks(); m.preferences.mockResolvedValue(emailPreferenceDefaults);
  m.articleLimit.mockResolvedValue([{ id: "article", source: "News", headline: "Headline", summary: "Summary", url: "https://news.invalid/article" }]);
  m.template.mockReturnValue({ subject: "Digest", html: "<p>Briefing</p>" });
  m.scopes.mockResolvedValue([scope]);
});
it("invokes the real delivery path with minimal bounded scoped data", async () => {
  await sendDigestForScope(scope, new Date("2026-09-19T10:00:00Z"));
  expect(m.articleLimit).toHaveBeenCalledWith(100); expect(m.execute).toHaveBeenCalledTimes(1);
  // Only what the email needs: the address and the name for the greeting.
  expect(Object.keys(m.select.mock.calls[0][0])).toEqual(["email", "name"]);
  expect(Object.keys(m.select.mock.calls[1][0])).toEqual(["id", "source", "headline", "summary", "url"]);
  expect(m.send).toHaveBeenCalledWith(expect.objectContaining({ userId: "user", type: "daily_digest", recipientName: "Arjun Mehta",
    dedupeKey: '["daily-digest-v1","tenant","user","2026-09-19"]', digestContext: { tenantId: "tenant", articleIds: ["article"] } }));
});
it("requires publication time within exactly 48 hours, falls back only to discovery, and excludes future articles", async () => {
  await sendDigestForScope(scope, new Date("2026-10-23T10:00:00Z"));
  const query = new PgDialect().sqlToQuery(m.where.mock.calls[0][0]);
  expect(query.sql).toContain('coalesce("inbox_items"."published_at", "inbox_items"."discovered_at") >=');
  expect(query.sql).toContain('coalesce("inbox_items"."published_at", "inbox_items"."discovered_at") <=');
  expect(query.sql).not.toContain("created_at");
  expect(query.params).toContain("2026-10-21T10:00:00.000Z");
  expect(query.params).toContain("2026-10-23T10:00:00.000Z");
  const order = m.orderBy.mock.calls[0].map(expression => new PgDialect().sqlToQuery(sql`${expression}`).sql);
  expect(order).toEqual([
    'coalesce("inbox_items"."published_at", "inbox_items"."discovered_at") desc',
    'coalesce("inbox_items"."ranking_score", "inbox_items"."relevance_score") desc nulls last',
    '"inbox_items"."id"',
  ]);
});
it("excludes articles claimed or sent in any earlier digest for this tenant and user, not just today's slot", async () => {
  await sendDigestForScope(scope, new Date("2026-10-23T10:00:00Z"));
  const query = new PgDialect().sqlToQuery(m.where.mock.calls[0][0]);
  expect(query.sql).toContain("not exists (select 1");
  expect(query.sql).toContain('"email_deliveries"."user_id" =');
  expect(query.sql).toContain('"email_deliveries"."type" = \'daily_digest\'');
  expect(query.sql).toContain('"email_deliveries"."status" in (\'pending\', \'sending\', \'sent\', \'unknown\')');
  expect(query.sql).toContain('"email_deliveries"."digest_context"->>\'tenantId\' =');
  expect(query.sql).toContain('("email_deliveries"."digest_context"->\'articleIds\') ? "inbox_items"."id"');
  expect(query.sql).not.toContain("dedupe_key");
  expect(query.params).toEqual(["tenant", "user", "active", "2026-10-21T10:00:00.000Z", "2026-10-23T10:00:00.000Z", "user", "tenant"]);
});
it("does not select inbox or users before a due opted-in slot", async () => {
  await sendDigestForScope(scope, new Date("2026-09-19T08:59:00Z"));
  m.preferences.mockResolvedValue({ ...emailPreferenceDefaults, dailyDigest: false });
  await sendDigestForScope(scope, new Date("2026-09-19T10:00:00Z"));
  expect(m.select).not.toHaveBeenCalled(); expect(m.send).not.toHaveBeenCalled();
});
it("omits credentialed and non-http URLs and sends the empty-state briefing", async () => {
  m.articleLimit.mockResolvedValue([{ url: "https://secret:password@news.invalid/" }, { url: "javascript:alert(1)" }]);
  await sendDigestForScope(scope, new Date("2026-09-19T10:00:00Z"));
  expect(m.template).toHaveBeenCalledWith([]);
  expect(m.send).toHaveBeenCalledWith(expect.objectContaining({ digestContext: { tenantId: "tenant", articleIds: [] } }));
});
it("sends a no-new-stories briefing when the fresh unemailed selection is empty", async () => {
  m.articleLimit.mockResolvedValue([]);
  await sendDigestForScope(scope, new Date("2026-10-23T10:00:00Z"));
  expect(m.template).toHaveBeenCalledWith([]);
  expect(m.send).toHaveBeenCalledWith(expect.objectContaining({
    dedupeKey: '["daily-digest-v1","tenant","user","2026-10-23"]',
    digestContext: { tenantId: "tenant", articleIds: [] },
  }));
});
it("fills up to five safe stories from bounded candidates and records only the included identities", async () => {
  const article = { source: "News", headline: "Headline", summary: "Summary" };
  m.articleLimit.mockResolvedValue([
    { ...article, id: "unsafe", url: "javascript:alert(1)" },
    ...Array.from({ length: 7 }, (_, i) => ({ ...article, id: `article-${i}`, url: `https://news.invalid/${i}` })),
  ]);
  await sendDigestForScope(scope, new Date("2026-10-23T10:00:00Z"));
  expect(m.template.mock.calls[0][0]).toHaveLength(5);
  expect(m.send).toHaveBeenCalledWith(expect.objectContaining({
    digestContext: { tenantId: "tenant", articleIds: ["article-0", "article-1", "article-2", "article-3", "article-4"] },
  }));
});
it("scheduler runs recovery and only one keyset page per tick", async () => {
  const connected = vi.fn();
  await runEmailDigestCycle(connected);
  expect(m.recover).toHaveBeenCalledTimes(1); expect(m.scopes).toHaveBeenCalledTimes(1); expect(connected).toHaveBeenCalledTimes(1);
});
it("sends each person's reminder too, whether or not their digest goes out", async () => {
  m.preferences.mockResolvedValueOnce({ ...emailPreferenceDefaults, dailyDigest: false });
  await runEmailDigestCycle();
  m.preferences.mockRejectedValueOnce(new Error("digest failed"));
  await runEmailDigestCycle();
  expect(m.reminder).toHaveBeenCalledTimes(2); expect(m.reminder).toHaveBeenCalledWith(scope);
});
