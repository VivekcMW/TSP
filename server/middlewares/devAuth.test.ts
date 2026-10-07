import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  profile: vi.fn(), create: vi.fn(), update: vi.fn(),
  tenant: vi.fn().mockResolvedValue("dev-tenant"),
}));
vi.mock("../db", () => ({
  db: {
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => ({ rowCount: 0 }) }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "dev-user-local", email: "dev@localhost" }] }) }) }),
  },
}));
vi.mock("../storage", () => ({ storage: { getUserProfile: mocks.profile, createUserProfile: mocks.create, updateUserProfile: mocks.update } }));
vi.mock("../services/tenancy", () => ({ ensurePersonalTenant: mocks.tenant }));

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
describe("local development profile seeding", () => {
  it.each(["completed", "in-progress", "not-started"])("preserves existing %s setup across a restart", async onboardingStatus => {
    mocks.profile.mockResolvedValue({ onboardingStatus });
    const { resolveDevUser } = await import("./devAuth");
    await resolveDevUser();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("starts onboarding only when the development profile is new", async () => {
    mocks.profile.mockResolvedValue(undefined);
    const { resolveDevUser } = await import("./devAuth");
    await resolveDevUser();
    expect(mocks.create).toHaveBeenCalledWith({ tenantId: "dev-tenant", userId: "dev-user-local" },
      expect.objectContaining({ onboardingStatus: "not-started" }));
  });
});
