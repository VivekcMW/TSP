import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("../authentication", () => ({ auth: { api: { getSession } } }));

import { pool } from "../db";
import { ownerDb, ownerPool } from "../../test/db-owner";
import { users } from "@shared/models/auth";
import { requireDbUser } from "./requireDbUser";

function appWithProbe(): Express { const app = express(); app.get("/probe", requireDbUser, (req, res) => res.json({ id: req.dbUser?.id, email: req.dbUser?.email })); return app; }
function session(id: string, emailVerified = true) { return { user: { id, emailVerified } }; }

beforeEach(async () => { vi.clearAllMocks(); await ownerDb.delete(users); });
afterAll(async () => { await pool.end(); await ownerPool.end(); });

describe("requireDbUser", () => {
  it("rejects a request with no Better Auth session", async () => { getSession.mockResolvedValue(null); await request(appWithProbe()).get("/probe").expect(401); });
  it("rejects an unverified Better Auth account", async () => { getSession.mockResolvedValue(session("u", false)); await request(appWithProbe()).get("/probe").expect(403); });
  it("resolves a verified Better Auth user", async () => {
    await ownerDb.insert(users).values({ id: "u", email: "u@example.test", name: "User" }); getSession.mockResolvedValue(session("u"));
    const res = await request(appWithProbe()).get("/probe").expect(200); expect(res.body).toEqual({ id: "u", email: "u@example.test" });
  });
  it("rejects a verified session whose user no longer exists", async () => { getSession.mockResolvedValue(session("missing")); await request(appWithProbe()).get("/probe").expect(401); });
});
