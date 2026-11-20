import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ scopes: vi.fn(), recover: vi.fn(), billing: vi.fn(), announcements: vi.fn(), weekly: vi.fn() }));
vi.mock("../storage", () => ({ storage: { getSchedulerScopes: m.scopes } }));
vi.mock("../services/email/delivery-store", () => ({ recoverEmailDeliveries: m.recover }));
vi.mock("../services/email/billing-notifications", () => ({ runBillingNotificationBatch: m.billing }));
vi.mock("../services/email/announcements", () => ({ runAnnouncementBatch: m.announcements }));
vi.mock("./email-weekly-summary", () => ({ sendWeeklySummaryForScope: m.weekly }));
import { runEmailCommunicationsCycle } from "./email-communications";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("EMAIL_WEEKLY_SUMMARY_ENABLED", "false"); vi.stubEnv("EMAIL_ANNOUNCEMENTS_ENABLED", "false"); m.scopes.mockResolvedValue([{ tenantId: "t", userId: "u" }]); });
afterEach(() => vi.unstubAllEnvs());
it("always recovers essential billing notices without enabling summaries or announcements", async () => {
  await runEmailCommunicationsCycle();
  expect(m.recover).toHaveBeenCalledOnce(); expect(m.billing).toHaveBeenCalledOnce();
  expect(m.weekly).not.toHaveBeenCalled(); expect(m.announcements).not.toHaveBeenCalled();
});
it("uses independent opt-in flags and does not let one scoped summary failure block other communications", async () => {
  vi.stubEnv("EMAIL_WEEKLY_SUMMARY_ENABLED", "true"); vi.stubEnv("EMAIL_ANNOUNCEMENTS_ENABLED", "true");
  m.weekly.mockRejectedValueOnce(new Error("summary unavailable"));
  const assertConnected = vi.fn();
  await runEmailCommunicationsCycle(assertConnected);
  expect(m.weekly).toHaveBeenCalledOnce(); expect(m.billing).toHaveBeenCalledOnce(); expect(m.announcements).toHaveBeenCalledOnce();
  expect(assertConnected).toHaveBeenCalled();
});
