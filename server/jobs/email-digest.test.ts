import { beforeEach, expect, it, vi } from "vitest";
import { emailPreferenceDefaults } from "@shared/email-preferences";
import { guardNotificationsMediaNetwork } from "../../test/notifications-media-network";
const m = vi.hoisted(() => ({ preferences: vi.fn(), send: vi.fn(), template: vi.fn(), execute: vi.fn(), select: vi.fn(), articleLimit: vi.fn(), scopes: vi.fn(), recover: vi.fn() }));
vi.mock("../storage", () => ({ storage: { getSchedulerScopes: m.scopes } }));
vi.mock("../db", () => ({ db: {
  select: (fields: unknown) => { m.select(fields); return { from: () => ({ where: () => ({ limit: async () => [{ email: "test@example.invalid", name: "Arjun Mehta" }] }) }) }; },
  transaction: async (work: any) => work({ execute: m.execute,
    select: (fields: unknown) => { m.select(fields); return { from: () => ({ where: () => ({ orderBy: () => ({ limit: m.articleLimit }) }) }) }; } }),
} }));
vi.mock("../services/email/preferences", () => ({ getEmailPreferences: m.preferences }));
vi.mock("../services/email", () => ({ deliverAppEmail: m.send, emailTemplates: { dailyDigest: m.template } }));
vi.mock("../services/email/delivery-store", () => ({ recoverEmailDeliveries: m.recover }));
import { runEmailDigestCycle, sendDigestForScope } from "./email-digest";
guardNotificationsMediaNetwork();
const scope = { tenantId: "tenant", userId: "user" };
beforeEach(() => {
  vi.clearAllMocks(); m.preferences.mockResolvedValue(emailPreferenceDefaults);
  m.articleLimit.mockResolvedValue([{ source: "News", headline: "Headline", summary: "Summary", url: "https://news.invalid/article" }]);
  m.template.mockReturnValue({ subject: "Digest", html: "<p>Briefing</p>" });
  m.scopes.mockResolvedValue([scope]);
});
it("invokes the real delivery path with minimal bounded scoped data", async () => {
  await sendDigestForScope(scope, new Date("2026-09-19T10:00:00Z"));
  expect(m.articleLimit).toHaveBeenCalledWith(5); expect(m.execute).toHaveBeenCalledTimes(1);
  // Only what the email needs: the address and the name for the greeting.
  expect(Object.keys(m.select.mock.calls[0][0])).toEqual(["email", "name"]);
  expect(Object.keys(m.select.mock.calls[1][0])).toEqual(["source", "headline", "summary", "url"]);
  expect(m.send).toHaveBeenCalledWith(expect.objectContaining({ userId: "user", type: "daily_digest", recipientName: "Arjun Mehta", dedupeKey: '["daily-digest-v1","tenant","user","2026-09-19"]' }));
});
it("does not select inbox or users before a due opted-in slot", async () => {
  await sendDigestForScope(scope, new Date("2026-09-19T08:59:00Z"));
  m.preferences.mockResolvedValue({ ...emailPreferenceDefaults, dailyDigest: false });
  await sendDigestForScope(scope, new Date("2026-09-19T10:00:00Z"));
  expect(m.select).not.toHaveBeenCalled(); expect(m.send).not.toHaveBeenCalled();
});
it("omits credentialed and non-http URLs and skips empty digests", async () => {
  m.articleLimit.mockResolvedValue([{ url: "https://secret:password@news.invalid/" }, { url: "javascript:alert(1)" }]);
  await sendDigestForScope(scope, new Date("2026-09-19T10:00:00Z"));
  expect(m.send).not.toHaveBeenCalled();
});
it("scheduler runs recovery and only one keyset page per tick", async () => {
  const connected = vi.fn();
  await runEmailDigestCycle(connected);
  expect(m.recover).toHaveBeenCalledTimes(1); expect(m.scopes).toHaveBeenCalledTimes(1); expect(connected).toHaveBeenCalledTimes(1);
});