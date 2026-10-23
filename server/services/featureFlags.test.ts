import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["from", "where"]) obj[method] = vi.fn(() => obj);
  obj.limit = vi.fn(async () => result);
  return obj;
}

const mocks = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("../db", () => ({ db: { select: mocks.select } }));

import { clearFeatureFlagCache, evaluateFlag, isFeatureEnabled } from "./featureFlags";

beforeEach(() => {
  mocks.select.mockReset();
  clearFeatureFlagCache();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("isFeatureEnabled", () => {
  it("defaults to enabled when no row exists, so an unconfigured flag never silently disables a shipped feature", async () => {
    mocks.select.mockReturnValueOnce(chain([]));
    await expect(isFeatureEnabled("team_workspaces")).resolves.toBe(true);
  });

  it("honors an explicit fallback for a missing row", async () => {
    mocks.select.mockReturnValueOnce(chain([]));
    await expect(isFeatureEnabled("team_workspaces", false)).resolves.toBe(false);
  });

  it("reflects the stored value when a row exists", async () => {
    mocks.select.mockReturnValueOnce(chain([{ enabled: false }]));
    await expect(isFeatureEnabled("team_workspaces")).resolves.toBe(false);
  });

  it("caches a result for 30s instead of querying on every call", async () => {
    mocks.select.mockReturnValueOnce(chain([{ enabled: false }]));
    await expect(isFeatureEnabled("team_workspaces")).resolves.toBe(false);
    await expect(isFeatureEnabled("team_workspaces")).resolves.toBe(false);
    expect(mocks.select).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_001);
    mocks.select.mockReturnValueOnce(chain([{ enabled: true }]));
    await expect(isFeatureEnabled("team_workspaces")).resolves.toBe(true);
    expect(mocks.select).toHaveBeenCalledTimes(2);
  });

  it("caches each key independently", async () => {
    mocks.select.mockReturnValueOnce(chain([{ enabled: false }])).mockReturnValueOnce(chain([{ enabled: true }]));
    await expect(isFeatureEnabled("a")).resolves.toBe(false);
    await expect(isFeatureEnabled("b")).resolves.toBe(true);
    expect(mocks.select).toHaveBeenCalledTimes(2);
  });
  it("does not cache one tenant's rollout decision as another tenant's authorization", async () => {
    mocks.select.mockReturnValue(chain([{ enabled: true, tenantIds: ["tenant-a"], expiresAt: new Date(Date.now() + 60_000) }]));
    await expect(isFeatureEnabled("team_workspaces", true, "tenant-a")).resolves.toBe(true);
    await expect(isFeatureEnabled("team_workspaces", true, "tenant-b")).resolves.toBe(false);
    await expect(isFeatureEnabled("team_workspaces")).resolves.toBe(false);
    expect(mocks.select).toHaveBeenCalledTimes(1);
  });
  it("enforces exact expiry even during the row cache lifetime and respects per-call missing fallback", async () => {
    mocks.select.mockReturnValueOnce(chain([{ enabled: true, expiresAt: new Date(Date.now() + 1000) }]));
    await expect(isFeatureEnabled("team_workspaces")).resolves.toBe(true);
    vi.advanceTimersByTime(1000);
    await expect(isFeatureEnabled("team_workspaces")).resolves.toBe(false);
    expect(evaluateFlag(undefined, true)).toBe(true); expect(evaluateFlag(undefined, false)).toBe(false);
  });
});
