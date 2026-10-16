import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["from", "where"]) obj[method] = vi.fn(() => obj);
  obj.limit = vi.fn(async () => result);
  return obj;
}

const mocks = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("../db", () => ({ db: { select: mocks.select } }));

import { clearFeatureFlagCache, isFeatureEnabled } from "./featureFlags";

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
});
