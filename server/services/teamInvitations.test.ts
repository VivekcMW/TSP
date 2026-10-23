import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

/**
 * Generic chainable Drizzle query-builder stand-in: every chain method
 * (from/where/innerJoin/orderBy/limit/set/values) returns the same object, and
 * the object itself is thenable so both `await db.update(...).set(...).where(...)`
 * (no .returning()) and `await db.insert(...).values(...).returning()` resolve
 * to the configured result.
 */
function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["from", "where", "innerJoin", "leftJoin", "orderBy", "limit", "set", "values"]) {
    obj[method] = vi.fn(() => obj);
  }
  obj.returning = vi.fn(async () => result);
  obj.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  obj.catch = (reject: (error: unknown) => unknown) => Promise.resolve(result).catch(reject);
  return obj;
}

const mocks = vi.hoisted(() => ({
  select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn(),
  txExecute: vi.fn(), txSelect: vi.fn(), txInsert: vi.fn(), txUpdate: vi.fn(),
}));
vi.mock("../db", () => ({ db: { select: mocks.select, insert: mocks.insert, update: mocks.update, delete: mocks.delete, transaction: mocks.transaction } }));

import {
  acceptTenantInvitation, inviteTenantMember, listPendingInvitations, listTenantMembers,
  removeTenantMember, revokeInvitation, updateTenantMemberRole,
} from "./teamInvitations";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const tenantId = "tenant-1";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) =>
    run({ execute: mocks.txExecute, select: mocks.txSelect, insert: mocks.txInsert, update: mocks.txUpdate }));
});
afterEach(() => vi.restoreAllMocks());

describe("listTenantMembers / listPendingInvitations", () => {
  it("maps member rows with their tenant role", async () => {
    mocks.select.mockReturnValueOnce(chain([{ userId: "user-2", name: "Sam", email: "sam@example.test", role: "manager", joinedAt: new Date("2026-01-01") }]));
    await expect(listTenantMembers(tenantId)).resolves.toEqual([
      { userId: "user-2", name: "Sam", email: "sam@example.test", role: "manager", joinedAt: new Date("2026-01-01") },
    ]);
  });

  it("maps pending invitation rows", async () => {
    mocks.select.mockReturnValueOnce(chain([{ id: "invite-1", email: "new@example.test", role: "member", invitedAt: new Date(), expiresAt: new Date() }]));
    const result = await listPendingInvitations(tenantId);
    expect(result).toHaveLength(1);
    expect(result[0].email).toBe("new@example.test");
  });
});

describe("inviteTenantMember", () => {
  it("rejects inviting someone who is already a member", async () => {
    mocks.select
      .mockReturnValueOnce(chain([{ id: "existing-user" }]))
      .mockReturnValueOnce(chain([{ userId: "existing-user" }]));
    await expect(inviteTenantMember({ tenantId, email: "member@example.test", role: "member", invitedByUserId: "owner-1" }))
      .resolves.toEqual({ kind: "already_member" });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects a second invite while one is already pending", async () => {
    mocks.select
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain([{ id: "pending-invite" }]));
    await expect(inviteTenantMember({ tenantId, email: "new@example.test", role: "member", invitedByUserId: "owner-1" }))
      .resolves.toEqual({ kind: "already_invited" });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("creates an invitation and returns only a hex token, storing just its hash", async () => {
    mocks.select.mockReturnValueOnce(chain([])).mockReturnValueOnce(chain([]));
    let storedValues: Record<string, unknown> = {};
    mocks.insert.mockReturnValueOnce({
      values: vi.fn((values: Record<string, unknown>) => { storedValues = values; return { returning: async () => [{ id: "invite-1" }] }; }),
    });
    const result = await inviteTenantMember({ tenantId, email: " NEW@Example.Test ", role: "manager", invitedByUserId: "owner-1" });
    expect(result.kind).toBe("invited");
    if (result.kind !== "invited") throw new Error("expected invited");
    expect(result.token).toMatch(/^[a-f0-9]{64}$/);
    expect(storedValues.invitedEmail).toBe("new@example.test");
    expect(storedValues.tokenHash).toBe(sha(result.token));
    expect(storedValues.tokenHash).not.toBe(result.token);
  });
});

describe("revokeInvitation", () => {
  it("returns true only when a pending invitation row was actually revoked", async () => {
    mocks.update.mockReturnValueOnce(chain([{ id: "invite-1" }]));
    await expect(revokeInvitation(tenantId, "invite-1")).resolves.toBe(true);
    mocks.update.mockReturnValueOnce(chain([]));
    await expect(revokeInvitation(tenantId, "invite-2")).resolves.toBe(false);
  });
});

describe("acceptTenantInvitation", () => {
  const baseInvitation = { id: "invite-1", tenantId, invitedEmail: "new@example.test", role: "member", tokenHash: sha("token"), status: "pending" };

  it("rejects a missing or expired invitation", async () => {
    mocks.txSelect.mockReturnValueOnce(chain([]));
    await expect(acceptTenantInvitation({ userId: "user-2", userEmail: "new@example.test", token: "token" })).resolves.toEqual({ kind: "invalid" });

    mocks.txSelect.mockReturnValueOnce(chain([{ ...baseInvitation, expiresAt: new Date(Date.now() - 1000) }]));
    await expect(acceptTenantInvitation({ userId: "user-2", userEmail: "new@example.test", token: "token" })).resolves.toEqual({ kind: "invalid" });
  });

  it("rejects acceptance from a different email than the invitation", async () => {
    mocks.txSelect.mockReturnValueOnce(chain([{ ...baseInvitation, expiresAt: new Date(Date.now() + 60_000) }]));
    await expect(acceptTenantInvitation({ userId: "user-2", userEmail: "someone-else@example.test", token: "token" }))
      .resolves.toEqual({ kind: "email_mismatch" });
  });

  it("marks already-member acceptance without creating a duplicate membership", async () => {
    mocks.txSelect
      .mockReturnValueOnce(chain([{ ...baseInvitation, expiresAt: new Date(Date.now() + 60_000) }]))
      .mockReturnValueOnce(chain([{ userId: "user-2" }]));
    mocks.txUpdate.mockReturnValueOnce(chain([]));
    await expect(acceptTenantInvitation({ userId: "user-2", userEmail: "new@example.test", token: "token" }))
      .resolves.toEqual({ kind: "already_member" });
    expect(mocks.txInsert).not.toHaveBeenCalled();
  });

  it("creates a membership with the invitation's role and marks it accepted, under the advisory lock", async () => {
    mocks.txSelect
      .mockReturnValueOnce(chain([{ ...baseInvitation, expiresAt: new Date(Date.now() + 60_000) }]))
      .mockReturnValueOnce(chain([]));
    mocks.txInsert.mockReturnValueOnce(chain([]));
    mocks.txUpdate.mockReturnValueOnce(chain([]));
    await expect(acceptTenantInvitation({ userId: "user-2", userEmail: "new@example.test", token: "token" }))
      .resolves.toEqual({ kind: "accepted", tenantId, role: "member" });
    expect(mocks.txExecute).toHaveBeenCalledTimes(1);
  });
});

describe("updateTenantMemberRole / removeTenantMember", () => {
  it("reports a missing member, blocks changing/removing the owner, and otherwise succeeds", async () => {
    mocks.select.mockReturnValueOnce(chain([]));
    await expect(updateTenantMemberRole(tenantId, "ghost", "manager")).resolves.toEqual({ kind: "not_found" });

    mocks.select.mockReturnValueOnce(chain([{ role: "owner" }]));
    await expect(updateTenantMemberRole(tenantId, "owner-1", "manager")).resolves.toEqual({ kind: "owner_immutable" });
    expect(mocks.update).not.toHaveBeenCalled();

    mocks.select.mockReturnValueOnce(chain([{ role: "member" }]));
    mocks.update.mockReturnValueOnce(chain([]));
    await expect(updateTenantMemberRole(tenantId, "user-2", "manager")).resolves.toEqual({ kind: "updated" });

    mocks.select.mockReturnValueOnce(chain([]));
    await expect(removeTenantMember(tenantId, "ghost")).resolves.toEqual({ kind: "not_found" });

    mocks.select.mockReturnValueOnce(chain([{ role: "owner" }]));
    await expect(removeTenantMember(tenantId, "owner-1")).resolves.toEqual({ kind: "owner_immutable" });
    expect(mocks.delete).not.toHaveBeenCalled();

    mocks.select.mockReturnValueOnce(chain([{ role: "member" }]));
    mocks.delete.mockReturnValueOnce(chain([]));
    await expect(removeTenantMember(tenantId, "user-2")).resolves.toEqual({ kind: "removed" });
  });
});
