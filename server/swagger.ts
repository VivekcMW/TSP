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
