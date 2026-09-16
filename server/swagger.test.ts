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
    expect(jsonRes.body.paths["/api/drafts/{id}/publish-status"]?.get).toMatchObject({
      security: [{ sessionCookie: [] }],
      responses: {
        "404": expect.any(Object),
        "503": expect.any(Object),
      },
    });
    expect(jsonRes.body.paths["/api/drafts/{id}/publish-status"]?.get.responses["200"].headers["Cache-Control"].schema.enum).toEqual(["no-store"]);
    expect(jsonRes.body.paths["/api/drafts/{id}/publish-status"]?.get.responses["200"].content["application/json"].schema.$ref).toBe("#/components/schemas/DraftPublishStatusResponse");
    expect(jsonRes.body.components.schemas.DraftPublishStatusResponse.properties.schedule).toMatchObject({
      nullable: true,
      allOf: [{ $ref: "#/components/schemas/DraftPublishStatusSchedule" }],
    });
  });
});
