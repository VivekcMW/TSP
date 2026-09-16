import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { pool } from "./db";
import { initializeQueues } from "./jobs/queue";
import { getQueueHealth } from "./jobs/queue";
import { registerJobHandlers, closeJobHandlers } from "./jobs";
import { initializeScheduler, stopScheduler } from "./jobs/scheduler";
import { setupSwagger } from "./swagger";
import { auth } from "./authentication";
import { closeEmailQueue, initializeEmailQueue, registerEmailWorker } from "./services/email";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Origin allowlist instead of reflecting any origin — credentials:true +
// origin:true would otherwise let any site make authenticated requests.
const extraAllowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const allowedOriginPatterns: (string | RegExp)[] = [...extraAllowedOrigins];

if (process.env.APP_URL) {
  allowedOriginPatterns.push(process.env.APP_URL.replace(/\/$/, ""));
}
if (process.env.NODE_ENV !== "production") {
  // Local browsers commonly switch between localhost and 127.0.0.1;
  // both names resolve to the same development server.
  allowedOriginPatterns.push(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
}

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      // No Origin header = same-origin or non-browser request (curl, server-to-server).
      if (!origin) return callback(null, true);
      const allowed = allowedOriginPatterns.some((pattern) =>
        typeof pattern === "string" ? pattern === origin : pattern.test(origin),
      );
      callback(allowed ? null : new Error(`Origin ${origin} not allowed by CORS`), allowed);
    },
  }),
);

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// Better Auth owns sign-up, sign-in, secure sessions, and email verification.
app.all("/api/auth/*", toNodeHandler(auth));

setupSwagger(app);

// Liveness/readiness probe for the deploy platform — no auth, no Clerk dependency.
app.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("[healthz] DB check failed:", error);
    res.status(503).json({ status: "error" });
  }
});

app.get("/readyz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    const queue = await getQueueHealth();
    const jobsRequired = process.env.NODE_ENV === "production" && process.env.BACKGROUND_JOBS_ENABLED === "true";
    const ready = !jobsRequired || (queue.reachable && queue.queuesReady);
    res.status(ready ? 200 : 503).json({ status: ready ? "ok" : "not_ready", database: "ok", queue, jobsRequired });
  } catch (error) {
    console.error("[readyz] readiness check failed:", error);
    res.status(503).json({ status: "not_ready", database: "error" });
  }
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

(async () => {
  // Initialize background job queue (if Redis is configured)
  initializeQueues();
  initializeEmailQueue();
  registerEmailWorker();
  await registerJobHandlers();

  // Initialize scheduler for cron-based pre-warming (if enabled)
  await initializeScheduler();

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // Serves both the API and the client from one port.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[shutdown] SIGTERM received, closing gracefully...");
  await stopScheduler();
  await closeJobHandlers();
  await closeEmailQueue();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[shutdown] SIGINT received, closing gracefully...");
  await stopScheduler();
  await closeJobHandlers();
  await closeEmailQueue();
  process.exit(0);
});
