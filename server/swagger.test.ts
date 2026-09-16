import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { setupSwagger } from "./swagger";

describe("swagger setup", () => {
  it("serves the OpenAPI JSON and Swagger UI", async () => {
    const app = express();
    setupSwagger(app);

    const uiRes = await request(app).get("/api-docs/").expect(200);
    expect(uiRes.text).toContain("Swagger UI");

    const jsonRes = await request(app).get("/api-docs.json").expect(200);
    expect(jsonRes.body.openapi).toBe("3.0.0");
  });
});
