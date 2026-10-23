import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { apiNotFound } from "./apiNotFound";

describe("unknown API paths", () => {
  const app = express();
  app.get("/api/known", (_req, res) => res.json({ ok: true }));
  app.use("/api", apiNotFound);
  // Stands in for the web app's catch-all page.
  app.use("*", (_req, res) => res.type("html").send("<!doctype html><title>App</title>"));

  it("answers JSON 404 for any method instead of the web page", async () => {
    for (const method of ["get", "post", "patch", "delete"] as const) {
      const response = await request(app)[method]("/api/ai/analyze-identity");
      expect(response.status).toBe(404);
      expect(response.headers["content-type"]).toMatch(/^application\/json/);
      expect(response.body).toEqual({ code: "not_found", message: "This API endpoint does not exist." });
    }
  });

  it("leaves known API routes and web pages alone", async () => {
    expect((await request(app).get("/api/known")).body).toEqual({ ok: true });
    expect((await request(app).get("/dashboard")).text).toContain("<title>App</title>");
  });
});
