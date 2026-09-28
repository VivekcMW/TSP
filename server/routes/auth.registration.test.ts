import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requireLocalTestDatabase } from "../../test/database-safety";
import { pool } from "../db";
import { ownerDb, ownerPool } from "../../test/db-owner";
import { emailPreferences, users } from "@shared/schema";

// Runs through the tsp_app role, as production does. No email leaves the test.
const signedIn = vi.hoisted(() => ({ id: "" }));
vi.mock("../middlewares/requireDbUser", () => ({
  requireDbUser: (_req: unknown, _res: unknown, next: () => void) => next(),
  authedOf: () => ({ dbUser: { id: signedIn.id } }),
}));
vi.mock("../services/email", async importOriginal => ({
  ...await importOriginal<typeof import("../services/email")>(),
  sendAppEmail: vi.fn(async () => undefined),
}));
import { registerAuthRoutes } from "./auth";

const traveller = randomUUID();
const oddBrowser = randomUUID();
const app = express();
app.use(express.json());
registerAuthRoutes(app);
const details = { firstName: "Ana", lastName: "Silva", countries: ["Brazil"], industries: ["technology-saas"] };
const digestZone = async (userId: string) =>
  (await ownerDb.select({ zone: emailPreferences.digestTimezone }).from(emailPreferences).where(eq(emailPreferences.userId, userId)))[0]?.zone;
let validated = false;

beforeAll(async () => {
  requireLocalTestDatabase();
  const role = await pool.query("select rolsuper, rolbypassrls from pg_roles where rolname = current_user");
  expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  validated = true;
  await ownerDb.insert(users).values([traveller, oddBrowser].map(id => ({ id, email: `${id}@example.invalid` })));
});
afterAll(async () => {
  if (validated) {
    await ownerDb.delete(emailPreferences).where(inArray(emailPreferences.userId, [traveller, oddBrowser]));
    await ownerDb.delete(users).where(inArray(users.id, [traveller, oddBrowser]));
  }
  await pool.end(); await ownerPool.end();
});

describe("POST /api/complete-registration", () => {
  it("starts the digest in the time zone the browser reports", async () => {
    signedIn.id = traveller;
    await request(app).post("/api/complete-registration").send({ ...details, timeZone: "America/Sao_Paulo" }).expect(200);
    expect(await digestZone(traveller)).toBe("America/Sao_Paulo");
  });

  it("still completes registration when the browser reports nothing usable", async () => {
    signedIn.id = oddBrowser;
    const res = await request(app).post("/api/complete-registration").send({ ...details, timeZone: "Mars/Olympus_Mons" }).expect(200);
    expect(res.body).toMatchObject({ firstName: "Ana", country: "Brazil" });
    expect(await digestZone(oddBrowser)).toBeUndefined();
  });
});
