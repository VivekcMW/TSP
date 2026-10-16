import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createAccountCache } from "./account-cache";
import { EDITORIAL_RECOVERY_KEY, clearEditorialRecovery, readEditorialRecovery, saveEditorialRecovery } from "./editorial-recovery";

const scope = { tenantId: "tenant-a", userId: "account-a" };
const jobId = "00000000-0000-4000-8000-000000000001";
const requestIntent = "00000000-0000-4000-8000-000000000002";
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());

describe("metadata-only same-tab editorial recovery", () => {
  it("stores exactly scope and job/intent identifiers, not extra input properties", () => {
    saveEditorialRecovery({ ...scope, content: "private", token: "secret" } as typeof scope, jobId, requestIntent);
    expect(JSON.parse(values.get(EDITORIAL_RECOVERY_KEY)!)).toEqual({ ...scope, jobId, requestIntent });
    expect(readEditorialRecovery(scope)).toEqual({ ...scope, jobId, requestIntent });
  });
  it.each([{ userId: "account-b", tenantId: scope.tenantId }, { ...scope, tenantId: "tenant-b" }])("clears mismatched scope %j", next => {
    saveEditorialRecovery(scope, jobId, requestIntent);
    expect(readEditorialRecovery(next)).toBeUndefined(); expect(values.size).toBe(0);
  });
  it.each(["not JSON", "null", "[]", JSON.stringify({ ...scope, jobId: "../../api/private", requestIntent }),
    JSON.stringify({ ...scope, jobId, requestIntent, content: "private" })])("rejects malformed or overbroad metadata %s", raw => {
    values.set(EDITORIAL_RECOVERY_KEY, raw);
    expect(readEditorialRecovery(scope)).toBeUndefined(); expect(values.size).toBe(0);
  });
  it("does not clear a newer job when an old request finishes", () => {
    saveEditorialRecovery(scope, jobId, requestIntent);
    clearEditorialRecovery(requestIntent);
    expect(values.size).toBe(1);
    clearEditorialRecovery(jobId); expect(values.size).toBe(0);
  });
  it("preserves same-account reload but clears on logout and external account changes", async () => {
    const cache = createAccountCache(new QueryClient());
    saveEditorialRecovery(scope, jobId, requestIntent);
    await cache.synchronize(scope.userId); expect(values.size).toBe(1);
    await cache.synchronize("account-b"); expect(values.size).toBe(0);
    saveEditorialRecovery(scope, jobId, requestIntent);
    await cache.beginSignOut(); expect(values.size).toBe(0);
    await cache.finishSignOut();
    saveEditorialRecovery(scope, jobId, requestIntent);
    await cache.synchronize(null); expect(values.size).toBe(0);
  });
  it("degrades safely when browser storage is denied", () => {
    vi.stubGlobal("sessionStorage", { getItem() { throw new Error("denied"); }, setItem() { throw new Error("full"); }, removeItem() { throw new Error("denied"); } });
    expect(() => saveEditorialRecovery(scope, jobId, requestIntent)).not.toThrow();
    expect(readEditorialRecovery(scope)).toBeUndefined();
  });
});