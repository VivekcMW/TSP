import { beforeEach, describe, expect, it, vi } from "vitest";
import { emailCategoryKeys, emailPreferenceDefaults } from "@shared/email-preferences";
import { guardNotificationsMediaNetwork } from "../../../test/notifications-media-network";
const m = vi.hoisted(() => ({ row: undefined as any, values: vi.fn(), conflict: vi.fn() }));
vi.mock("../../db", () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => m.row ? [m.row] : [] }) }) }),
  insert: () => ({ values: (data: unknown) => { m.values(data); return { onConflictDoUpdate: (conflict: any) => {
    m.conflict(conflict); return { returning: async () => [{ ...(m.row ?? data), ...conflict.set }] };
  } }; } }),
} }));
import { getEmailPreferences, updateEmailPreferences } from "./preferences";
guardNotificationsMediaNetwork();
beforeEach(() => { vi.clearAllMocks(); m.row = undefined; });
describe("authoritative preference persistence", () => {
  it("returns documented defaults without creating an opt-in row", async () => {
    expect(await getEmailPreferences("user")).toEqual({ userId: "user", ...emailPreferenceDefaults, unsubscribedAt: null });
    expect(m.values).not.toHaveBeenCalled();
  });
  it("marketing opt-out updates only marketing, never global unsubscribe", async () => {
    await updateEmailPreferences("user", { marketing: false });
    expect(m.conflict.mock.calls[0][0].set).toEqual({ marketing: false, updatedAt: expect.any(Date) });
  });
  it("explicit unsubscribe disables every optional category", async () => {
    const saved = await updateEmailPreferences("user", { unsubscribeAll: true });
    for (const key of emailCategoryKeys) expect(saved[key]).toBe(false);
    expect(saved.unsubscribedAt).toBeInstanceOf(Date);
  });
  it("explicit re-opt-in enables only that category", async () => {
    m.row = { ...emailPreferenceDefaults, ...Object.fromEntries(emailCategoryKeys.map(key => [key, false])), unsubscribedAt: new Date() };
    const saved = await updateEmailPreferences("user", { publishing: true });
    expect(saved.publishing).toBe(true); expect(saved.unsubscribedAt).toBeNull(); expect(saved.marketing).toBe(false); expect(saved.dailyDigest).toBe(false);
    expect(Object.keys(m.conflict.mock.calls[0][0].set).sort()).toEqual(["publishing", "unsubscribedAt", "updatedAt"]);
  });
  it("timezone change does not revoke global opt-out", async () => {
    m.row = { ...emailPreferenceDefaults, unsubscribedAt: new Date() };
    const saved = await updateEmailPreferences("user", { digestTimezone: "Asia/Kolkata" });
    expect(saved.unsubscribedAt).toEqual(m.row.unsubscribedAt);
    expect(m.conflict.mock.calls[0][0].set).not.toHaveProperty("unsubscribedAt");
  });
});