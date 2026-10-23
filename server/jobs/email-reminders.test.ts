import { beforeEach, describe, expect, it, vi } from "vitest";
import { emailPreferenceDefaults } from "@shared/email-preferences";
import type { ReminderContext } from "./email-reminders";

vi.mock("../db", () => ({ db: {} }));
vi.mock("../services/email", async () => ({ deliverAppEmail: vi.fn(), emailTemplates: (await import("../services/email/templates")).emailTemplates }));
vi.mock("../services/email/preferences", () => ({ getEmailPreferences: vi.fn() }));
import { sendReminderForScope } from "./email-reminders";

const scope = { tenantId: "tenant", userId: "user-1" };
const now = new Date("2026-10-01T09:30:00Z");           // after the 09:00 UTC digest time
const DAY = 86_400_000;
const context = (overrides: Partial<ReminderContext> = {}): ReminderContext => ({
  email: "priya@example.test", firstName: "Priya", onboarded: true, lastActivity: new Date(now.getTime() - 8 * DAY), sent: [],
  stories: [{ headline: "IAB Europe releases a CTV measurement framework", source: "IAB Europe", url: "https://news.test/iab" }],
  topics: ["CTV Measurement"], platform: "linkedin", ...overrides,
});
const deps = () => ({ getEmailPreferences: vi.fn().mockResolvedValue({ ...emailPreferenceDefaults, userId: "user-1", unsubscribedAt: null }),
  loadReminderContext: vi.fn().mockResolvedValue(context()), deliverAppEmail: vi.fn().mockResolvedValue({ messageId: "m" }) });

describe("weekly reminders", () => {
  let d: ReturnType<typeof deps>;
  beforeEach(() => { d = deps(); });

  it("sends Email 1 after a quiet week, once per day slot, greeting by first name", async () => {
    await sendReminderForScope(scope, now, d);
    expect(d.deliverAppEmail).toHaveBeenCalledTimes(1);
    expect(d.deliverAppEmail).toHaveBeenCalledWith(expect.objectContaining({
      type: "re_engagement", userId: "user-1", recipient: "priya@example.test", recipientName: "Priya",
      dedupeKey: '["reminder-v1","user-1","2026-10-01"]', primaryCta: expect.objectContaining({ label: "Write my post" }),
    }));
  });

  it.each([
    [[now.getTime() - 7 * DAY], "The easiest post you'll write this month"],
    [[now.getTime() - 14 * DAY, now.getTime() - 7 * DAY], "Should we keep sending these, Priya?"],
  ])("moves through the series (%#)", async (sent, subject) => {
    d.loadReminderContext.mockResolvedValue(context({ lastActivity: new Date(now.getTime() - 22 * DAY), sent: sent.map(time => new Date(time)) }));
    await sendReminderForScope(scope, now, d);
    expect(d.deliverAppEmail).toHaveBeenCalledWith(expect.objectContaining({ subject }));
  });

  it("checks in monthly with Email 1 after the series", async () => {
    d.loadReminderContext.mockResolvedValue(context({ lastActivity: new Date(now.getTime() - 70 * DAY),
      sent: [55, 48, 31].map(days => new Date(now.getTime() - days * DAY)) }));
    await sendReminderForScope(scope, now, d);
    expect(d.deliverAppEmail).toHaveBeenCalledWith(expect.objectContaining({ primaryCta: expect.objectContaining({ label: "Write my post" }) }));
  });

  it.each([
    ["reminders are off", { reminders: false }],
    ["everything is unsubscribed", { unsubscribedAt: new Date() }],
    ["reminders are paused", { remindersPausedUntil: new Date(now.getTime() + DAY) }],
    ["it's before their digest time", { digestTime: "10:00" }],
  ])("sends nothing when %s", async (_label, preference) => {
    d.getEmailPreferences.mockResolvedValue({ ...emailPreferenceDefaults, userId: "user-1", unsubscribedAt: null, ...preference });
    await sendReminderForScope(scope, now, d);
    expect(d.deliverAppEmail).not.toHaveBeenCalled();
  });

  it("resumes once a pause is over", async () => {
    d.getEmailPreferences.mockResolvedValue({ ...emailPreferenceDefaults, userId: "user-1", unsubscribedAt: null, remindersPausedUntil: new Date(now.getTime() - DAY) });
    await sendReminderForScope(scope, now, d);
    expect(d.deliverAppEmail).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["setup isn't finished", { onboarded: false }],
    ["they were active this week", { lastActivity: new Date(now.getTime() - 2 * DAY) }],
    ["this week's reminder already went out", { sent: [new Date(now.getTime() - 3 * DAY)] }],
  ])("sends nothing when %s", async (_label, overrides) => {
    d.loadReminderContext.mockResolvedValue(context(overrides));
    await sendReminderForScope(scope, now, d);
    expect(d.deliverAppEmail).not.toHaveBeenCalled();
  });

  it("does not load anyone's data before a reminder could be due", async () => {
    d.getEmailPreferences.mockResolvedValue({ ...emailPreferenceDefaults, userId: "user-1", unsubscribedAt: null, reminders: false });
    await sendReminderForScope(scope, now, d);
    expect(d.loadReminderContext).not.toHaveBeenCalled();
  });
});
