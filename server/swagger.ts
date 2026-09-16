import type { Express } from "express";

export function setupSwagger(app: Express) {
  const swaggerDocument = {
    openapi: "3.0.0",
    info: {
      title: "The Social Pundit API",
      version: "1.0.0",
      description:
        "API documentation for drafts, scheduling, publishing, analytics, and provider integrations.",
    },
    servers: [
      {
        url: process.env.APP_URL || "http://localhost:5000",
        description: "Primary server",
      },
    ],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "better-auth.session_token",
          description: "Authenticated Better Auth session cookie required. Secure deployments may emit a secure-prefixed variant of the same cookie.",
        },
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          required: ["message"],
          properties: {
            message: {
              type: "string",
            },
          },
        },
        DraftScheduleTarget: {
          type: "object",
          required: ["id", "tenantId", "draftScheduleId", "platform", "status", "retryCount", "createdAt", "updatedAt"],
          properties: {
            id: { type: "string", format: "uuid" },
            tenantId: { type: "string", format: "uuid" },
            draftScheduleId: { type: "string", format: "uuid" },
            platform: { type: "string" },
            status: { type: "string" },
            retryCount: { type: "integer" },
            lastError: { type: "string", nullable: true },
            publishedAt: { type: "string", format: "date-time", nullable: true },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        DraftPublishStatusSchedule: {
          type: "object",
          required: ["id", "tenantId", "draftId", "scheduledPublishAt", "status", "createdAt", "updatedAt", "targets"],
          properties: {
            id: { type: "string", format: "uuid" },
            tenantId: { type: "string", format: "uuid" },
            draftId: { type: "string", format: "uuid" },
            scheduledPublishAt: { type: "string", format: "date-time" },
            status: { type: "string" },
            lastError: { type: "string", nullable: true },
            publishedAt: { type: "string", format: "date-time", nullable: true },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            targets: {
              type: "array",
              items: { $ref: "#/components/schemas/DraftScheduleTarget" },
            },
          },
        },
        DraftPublishStatusResponse: {
          type: "object",
          required: ["schedule"],
          properties: {
            schedule: {
              allOf: [{ $ref: "#/components/schemas/DraftPublishStatusSchedule" }],
              nullable: true,
              description: "Null when the draft exists in the caller's scope but has not been scheduled for publication.",
            },
          },
        },
      },
    },
    paths: {
      "/healthz": {
        get: {
          summary: "Health check",
          responses: {
            "200": {
              description: "Server is healthy",
            },
          },
        },
      },
      "/api/drafts": {
        get: {
          summary: "List drafts",
          responses: {
            "200": {
              description: "Draft list",
            },
          },
        },
      },
      "/api/drafts/{id}/publish-status": {
        get: {
          summary: "Get draft publish status",
          description: "Returns a tenant-scoped publication snapshot for one owned draft. Responses are always marked no-store because delivery state can change between reads.",
          tags: ["Drafts"],
          security: [{ sessionCookie: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Draft identifier.",
              schema: {
                type: "string",
              },
            },
          ],
          responses: {
            "200": {
              description: "Owned publication snapshot. The response shape always includes `schedule`, which is null when the draft exists but has no schedule.",
              headers: {
                "Cache-Control": {
                  description: "Always `no-store` so status checks are never cached.",
                  schema: {
                    type: "string",
                    enum: ["no-store"],
                  },
                },
              },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/DraftPublishStatusResponse" },
                  examples: {
                    unscheduled: {
                      summary: "Draft exists but has not been scheduled",
                      value: {
                        schedule: null,
                      },
                    },
                    scheduled: {
                      summary: "Scheduled draft with per-platform targets",
                      value: {
                        schedule: {
                          id: "6ca0b80d-509a-4df1-a9fd-8c1d447b4f4d",
                          tenantId: "1596226d-1bf0-40a0-854b-cd8e5a7d4bd6",
                          draftId: "ccb5a84f-8478-4af5-9fd5-2a4e02d0d455",
                          scheduledPublishAt: "2026-09-19T10:00:00.000Z",
                          status: "scheduled",
                          lastError: null,
                          publishedAt: null,
                          createdAt: "2026-09-17T08:30:00.000Z",
                          updatedAt: "2026-09-17T08:30:00.000Z",
                          targets: [
                            {
                              id: "76f66c77-b8b0-43b6-a658-a0b5ca6718cf",
                              tenantId: "1596226d-1bf0-40a0-854b-cd8e5a7d4bd6",
                              draftScheduleId: "6ca0b80d-509a-4df1-a9fd-8c1d447b4f4d",
                              platform: "linkedin",
                              status: "scheduled",
                              retryCount: 0,
                              lastError: null,
                              publishedAt: null,
                              createdAt: "2026-09-17T08:30:00.000Z",
                              updatedAt: "2026-09-17T08:30:00.000Z",
                            },
                          ],
                        },
                      },
                    },
                  },
                },
              },
            },
            "404": {
              description: "Draft not found in the caller's authenticated scope.",
              headers: {
                "Cache-Control": {
                  description: "Always `no-store` so missing draft checks are never cached.",
                  schema: {
                    type: "string",
                    enum: ["no-store"],
                  },
                },
              },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                  example: { message: "Draft not found" },
                },
              },
            },
            "503": {
              description: "Delivery status could not be verified at this time.",
              headers: {
                "Cache-Control": {
                  description: "Always `no-store` so transient verification failures are never cached.",
                  schema: {
                    type: "string",
                    enum: ["no-store"],
                  },
                },
              },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                  example: { message: "Delivery status could not be verified. Check status before retrying." },
                },
              },
            },
          },
        },
      },
      "/api/integrations": {
        get: {
          summary: "List available integrations",
          responses: {
            "200": {
              description: "Integration catalog",
            },
          },
        },
      },
    },
  };

  app.get("/api-docs.json", (_req, res) => {
    res.json(swaggerDocument);
  });

  app.get("/api-docs", (_req, res) => {
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>The Social Pundit API Docs</title>
    <meta name="description" content="Swagger UI for The Social Pundit API" />
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui.css" />
    <style>
      html, body { margin: 0; background: #0f172a; }
      body { font-family: system-ui, -apple-system, sans-serif; }
      #app { max-width: 1400px; margin: 0 auto; }
      .swagger-header { color: white; padding: 1rem 1.25rem; font-size: 1.1rem; font-weight: 600; }
    </style>
  </head>
  <body>
    <div class="swagger-header">Swagger UI</div>
    <div id="app"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-bundle.js"></script>
    <script>
      SwaggerUIBundle({
        url: '/api-docs.json',
        dom_id: '#app'
      });
    </script>
  </body>
</html>`;
    res.type("html").send(html);
  });

  return app;
}
