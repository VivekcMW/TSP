import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Clerk is faked at the module boundary: what is under test is how we react to
// Clerk's outputs, not Clerk itself.
vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(),
  clerkClient: { users: { getUser: vi.fn() } },
}));

import { clerkClient, getAuth } from "@clerk/express";
import { pool } from "../db";
import { ownerDb, ownerPool } from "../../test/db-owner";
import { users } from "@shared/models/auth";
import { requireDbUser } from "./requireDbUser";

const mockGetAuth = vi.mocked(getAuth);
const mockGetUser = vi.mocked(clerkClient.users.getUser);

function appWithProbe(): Express {
  const app = express();
  app.get("/probe", requireDbUser, (req, res) => {
    res.json({ id: req.dbUser?.id, email: req.dbUser?.email });
  });
  return app;
}

function signedInAs(userId: string | null) {
  mockGetAuth.mockReturnValue({ userId } as ReturnType<typeof getAuth>);
}

function clerkUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "clerk_123",
    firstName: "Ada",
    lastName: "Lovelace",
    imageUrl: "https://example.test/a.png",
    primaryEmailAddress: { emailAddress: "ada@example.test" },
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof clerkClient.users.getUser>>;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await ownerDb.delete(users);
});

afterAll(async () => {
  await pool.end();
  await ownerPool.end();
});

describe("requireDbUser", () => {
  it("rejects a request with no Clerk session", async () => {
    signedInAs(null);
    const res = await request(appWithProbe()).get("/probe");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Unauthorized" });
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("resolves an existing row without calling the Clerk Backend API", async () => {
    await ownerDb.insert(users).values({ id: "user_existing", email: "existing@example.test" });
    signedInAs("user_existing");

    const res = await request(appWithProbe()).get("/probe");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "user_existing", email: "existing@example.test" });
    // The whole point of provisioning on the miss path only: one API call per
    // user lifetime, not one per request.
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("provisions a missing row from the Clerk Backend API", async () => {
    signedInAs("user_new");
    mockGetUser.mockResolvedValue(clerkUser());

    const res = await request(appWithProbe()).get("/probe");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "user_new", email: "ada@example.test" });
    expect(mockGetUser).toHaveBeenCalledWith("user_new");

    const [row] = await ownerDb.select().from(users);
    expect(row).toMatchObject({
      id: "user_new",
      email: "ada@example.test",
      firstName: "Ada",
      lastName: "Lovelace",
    });
    // Registration is still outstanding — provisioning must not skip that gate.
    expect(row.registrationCompleted).toBeNull();
  });

  it("returns 422, not 401, when the Clerk account has no primary email", async () => {
    signedInAs("user_no_email");
    mockGetUser.mockResolvedValue(clerkUser({ primaryEmailAddress: null }));

    const res = await request(appWithProbe()).get("/probe");

    // 401 would send the client into a sign-out/sign-in loop against a state
    // it cannot fix. This is a data problem, so it must be terminal.
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/primary email/i);
    expect(await ownerDb.select().from(users)).toHaveLength(0);
  });

  it("survives two concurrent first requests without erroring or duplicating", async () => {
    signedInAs("user_race");
    mockGetUser.mockResolvedValue(clerkUser({ primaryEmailAddress: { emailAddress: "race@example.test" } }));

    const app = appWithProbe();
    const [a, b] = await Promise.all([
      request(app).get("/probe"),
      request(app).get("/probe"),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await ownerDb.select().from(users)).toHaveLength(1);
  });

  it("returns 500 when the Clerk Backend API fails", async () => {
    signedInAs("user_boom");
    mockGetUser.mockRejectedValue(new Error("clerk unavailable"));

    const res = await request(appWithProbe()).get("/probe");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Failed to resolve user" });
  });
});
