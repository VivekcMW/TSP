import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import { guardNotificationsMediaNetwork } from "../../test/notifications-media-network";

// The real route and preference service together; only the database is faked.
const m = vi.hoisted(() => ({ conflict: vi.fn() }));
vi.mock("../middlewares/requireDbUser", () => ({ requireDbUser: (_req: unknown, _res: unknown, next: () => void) => next(), authedOf: () => ({ dbUser: { id: "user-1" } }) }));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../db", () => ({ db: {
  insert: () => ({ values: (data: Record<string, unknown>) => ({ onConflictDoUpdate: (conflict: { set: Record<string, unknown> }) => {
    m.conflict(conflict.set); return { returning: async () => [{ ...data, ...conflict.set }] };
  } }) }),
} }));
import { registerEmailPreferenceRoutes } from "./email-preferences";

guardNotificationsMediaNetwork();
const app = express();
app.use(express.json());
registerEmailPreferenceRoutes(app);
beforeEach(() => vi.clearAllMocks());

it("saves a reminder pause sent from Settings", async () => {
  const until = new Date(Date.now() + 30 * 86_400_000);
  const response = await request(app).patch("/api/email-preferences").send({ remindersPausedUntil: until.toISOString() });
  expect(response.status).toBe(200);
  expect(m.conflict).toHaveBeenCalledWith({ remindersPausedUntil: until, updatedAt: expect.any(Date) });
  expect(response.body.remindersPausedUntil).toBe(until.toISOString());
});

it("resumes reminders and rejects pauses longer than a year", async () => {
  expect((await request(app).patch("/api/email-preferences").send({ remindersPausedUntil: null })).status).toBe(200);
  expect(m.conflict).toHaveBeenCalledWith({ remindersPausedUntil: null, updatedAt: expect.any(Date) });
  const tooLong = new Date(Date.now() + 400 * 86_400_000).toISOString();
  expect((await request(app).patch("/api/email-preferences").send({ remindersPausedUntil: tooLong })).status).toBe(400);
});
