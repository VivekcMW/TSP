import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock("../services/featureFlags", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));

import { requireFeatureEnabled } from "./requireFeatureEnabled";

const app = express();
app.get("/probe", requireFeatureEnabled("team_workspaces"), (_req, res) => res.json({ ok: true }));

beforeEach(() => mocks.isFeatureEnabled.mockReset());

describe("requireFeatureEnabled", () => {
  it("passes through when the flag is enabled", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(true);
    const response = await request(app).get("/probe");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith("team_workspaces");
  });

  it("returns 503 without reaching the handler when the flag is disabled", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);
    const response = await request(app).get("/probe");
    expect(response.status).toBe(503);
    expect(response.body.code).toBe("feature_disabled");
  });
});
