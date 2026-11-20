import { beforeEach, describe, expect, it, vi } from "vitest";
import { emailPreferenceDefaults } from "@shared/email-preferences";
import type { getEmailPreferences } from "../services/email/preferences";

vi.mock("../db", () => ({ db: new Proxy({}, { get() { throw new Error("No database in watch alert email tests"); } }) }));
vi.mock("../storage", () => ({ withTenantTransaction: () => { throw new Error("Use injected repositories"); } }));
vi.mock("../services/email", () => ({ deliverAppEmail: vi.fn(() => { throw new Error("Use injected delivery"); }) }));
vi.mock("../services/email/preferences", () => ({ getEmailPreferences: vi.fn(() => { throw new Error("Use injected preferences"); }) }));
import { alertSlot, alertStories, sendWatchAlertsForScope } from "./email-watch-alerts";

const scope = { tenantId: "tenant", userId: "user" };
const NOW = new Date("2026-11-16T09:42:00Z");
const preferences = (overrides: Partial<typeof emailPreferenceDefaults> & { unsubscribedAt?: Date | null } = {}) =>
  ({ userId: "user", ...emailPreferenceDefaults, unsubscribedAt: null as Date | null, ...overrides });
/** Stored rows also carry id and timestamps; the job only reads the preference values. */
const returning = (value: ReturnType<typeof preferences>) => vi.fn(async () => value) as unknown as typeof getEmailPreferences;
const alert = (id: string, term: string, url = "https://news.test/a") => ({ id, term, kind: "company", headline: "Zeta and Acme merge", source: "Wire", articleUrl: url });

function deps(overrides: Record<string, unknown> = {}) {
  return {
    getEmailPreferences: returning(preferences()),
    watchAlertEmailState: vi.fn(async () => ({ pendingSlot: null as string | null, claimable: true })),
    watchAlertEmailedWithinHour: vi.fn(async () => false),
    takeWatchAlertBatch: vi.fn(async () => [alert("1", "Zeta"), alert("2", "Acme"), alert("3", "Zeta", "https://news.test/b")]),
    closeWatchAlertSlot: vi.fn(async () => undefined),
    loadRecipient: vi.fn(async () => ({ email: "reader@example.invalid", name: "Asha" })),
    deliverAppEmail: vi.fn(async () => ({ messageId: "sent" })),
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("watch alert emails", () => {
  it("claims a batch under the current hour, sends one email per story list, then closes the slot", async () => {
    const d = deps();
    await sendWatchAlertsForScope(scope, NOW, d);
    expect(d.takeWatchAlertBatch).toHaveBeenCalledWith(scope, "2026-11-16T09", false, NOW);
    expect(d.deliverAppEmail).toHaveBeenCalledTimes(1);
    const email = (d.deliverAppEmail.mock.calls[0] as unknown[])[0] as Record<string, string>;
    expect(email).toMatchObject({ type: "watch_alert", userId: "user", dedupeKey: '["watch-alerts-v1","tenant","user","2026-11-16T09"]',
      subject: "2 new stories on your watchlist" });
    expect(email.text).toContain("Wire (mentions Zeta, Acme): Zeta and Acme merge\nhttps://news.test/a");
    expect(d.closeWatchAlertSlot).toHaveBeenCalledWith(scope, "2026-11-16T09");
    expect(d.deliverAppEmail.mock.invocationCallOrder[0]).toBeLessThan(d.closeWatchAlertSlot.mock.invocationCallOrder[0]);
  });

  it("sends nothing and claims nothing when there are no new alerts", async () => {
    const d = deps({ watchAlertEmailState: vi.fn(async () => ({ pendingSlot: null, claimable: false })) });
    await sendWatchAlertsForScope(scope, NOW, d);
    expect(d.watchAlertEmailedWithinHour).not.toHaveBeenCalled();
    expect(d.takeWatchAlertBatch).not.toHaveBeenCalled();
  });

  it("sends at most one email an hour", async () => {
    const d = deps({ watchAlertEmailedWithinHour: vi.fn(async () => true) });
    await sendWatchAlertsForScope(scope, NOW, d);
    expect(d.takeWatchAlertBatch).not.toHaveBeenCalled();
    expect(d.deliverAppEmail).not.toHaveBeenCalled();
  });

  it("retries an unclosed slot with the same delivery identity before claiming anything new", async () => {
    const d = deps({ watchAlertEmailState: vi.fn(async () => ({ pendingSlot: "2026-11-16T07", claimable: false })), watchAlertEmailedWithinHour: vi.fn(async () => true) });
    await sendWatchAlertsForScope(scope, NOW, d);
    expect(d.takeWatchAlertBatch).toHaveBeenCalledWith(scope, "2026-11-16T07", true, NOW);
    expect(d.deliverAppEmail).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: '["watch-alerts-v1","tenant","user","2026-11-16T07"]' }));
  });

  it("keeps the slot open when dispatch fails, so the ledger decides on the retry", async () => {
    const d = deps({ deliverAppEmail: vi.fn(async () => { throw new Error("Email delivery outcome is unknown; do not replay"); }) });
    await expect(sendWatchAlertsForScope(scope, NOW, d)).rejects.toThrow("unknown");
    expect(d.closeWatchAlertSlot).not.toHaveBeenCalled();
  });

  it("closes a slot whose alerts were all seen, without sending", async () => {
    const d = deps({ takeWatchAlertBatch: vi.fn(async () => []) });
    await sendWatchAlertsForScope(scope, NOW, d);
    expect(d.deliverAppEmail).not.toHaveBeenCalled();
    expect(d.closeWatchAlertSlot).toHaveBeenCalledWith(scope, "2026-11-16T09");
  });

  it("respects the preference and unsubscribe-all", async () => {
    for (const preference of [preferences({ watchlistAlerts: false }), preferences({ unsubscribedAt: new Date() })]) {
      const d = deps({ getEmailPreferences: returning(preference) });
      await sendWatchAlertsForScope(scope, NOW, d);
      expect(d.watchAlertEmailState).not.toHaveBeenCalled();
    }
  });

  it("groups terms per story and drops unsafe links", () => {
    expect(alertSlot(NOW)).toBe("2026-11-16T09");
    expect(alertStories([alert("1", "Zeta"), alert("2", "Zeta"), alert("3", "Acme"), alert("4", "Evil", "javascript:alert(1)")]))
      .toEqual([{ headline: "Zeta and Acme merge", source: "Wire", url: "https://news.test/a", terms: ["Zeta", "Acme"] }]);
  });
});
