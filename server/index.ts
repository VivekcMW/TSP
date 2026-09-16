import "dotenv/config";
import "./lib/env-aliases";
import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer, STATUS_CODES } from "node:http";
import type { Socket } from "node:net";
import { pool } from "./db";
import { initializeQueues, getQueueHealth } from "./jobs/queue";
import { registerJobHandlers, closeJobHandlers } from "./jobs";
import { initializeScheduler, stopScheduler } from "./jobs/scheduler";
import { setupSwagger } from "./swagger";
import { auth } from "./authentication";
import { closeEmailQueue, initializeEmailQueue, registerEmailWorker } from "./services/email";
import { configureProxy } from "./lib/proxy";
import { redis } from "./lib/redis";

export const app = express();
const httpServer = createServer(app);
const sockets = new Set<Socket>();
httpServer.on("connection", (socket) => {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
});
configureProxy(app);
let shuttingDown = false;
let closeEditorialJobs: (() => Promise<void>) | undefined;
app.use((_req, res, next) => {
  if (shuttingDown) {
    res.setHeader("Connection", "close");
    res.status(503).json({ message: "Server shutting down" });
    return;
  }
  next();
});

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
const authHandler = toNodeHandler(auth);
app.all("/api/auth/*", (req, res, next) => {
  // Express 4 does not catch rejected promises from async handlers.
  Promise.resolve().then(() => authHandler(req, res)).catch(next);
});

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

export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  const candidate = err as { status?: unknown; statusCode?: unknown } | null;
  const code = candidate?.status ?? candidate?.statusCode;
  const status = typeof code === "number" && Number.isInteger(code) && code >= 400 && code <= 599 ? code : 500;
  // Never log raw errors/headers/bodies or return internal exception messages.
  console.error(`[express] Request failed (${status})`);
  if (res.headersSent) {
    // Terminate a partial response via Express without leaking the original error.
    next(new Error("Request failed"));
    return;
  }
  res.status(status).json({ message: status >= 500 ? "Internal Server Error" : STATUS_CODES[status] ?? "Request failed" });
}

type ShutdownDependencies = {
  drainHttp: () => Promise<unknown>;
  stopScheduler: () => Promise<unknown>;
  closeJobs: () => Promise<unknown>;
  closeEmail: () => Promise<unknown>;
  closePool: () => Promise<unknown>;
  closeRedis: () => Promise<unknown>;
  forceClose: () => void;
  exit: (code: number) => void;
};

export function shutdownTimeout(value = process.env.SHUTDOWN_TIMEOUT_MS): number {
  const timeout = value === undefined ? 30_000 : Number(value);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 300_000) {
    throw new Error("SHUTDOWN_TIMEOUT_MS must be an integer from 1000 to 300000");
  }
  return timeout;
}

export function createGracefulShutdown(deps: ShutdownDependencies, timeoutMs: number) {
  let pending: Promise<void> | undefined;
  let exitCode = 0;
  const attempt = async (operation: () => Promise<unknown>) => {
    try { await operation(); }
    catch { exitCode = 1; console.error("[shutdown] Cleanup failed"); }
  };
  const stage = async (operations: Array<() => Promise<unknown>>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(operations.map(attempt)),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => { exitCode = 1; resolve(); }, Math.floor(timeoutMs / 3));
        }),
      ]);
    } finally { clearTimeout(timer); }
  };
  return (code = 0): Promise<void> => {
    exitCode = Math.max(exitCode, code);
    if (pending) return pending;
    pending = (async () => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        try { deps.forceClose(); } catch { exitCode = 1; }
        deps.exit(exitCode);
      };
      // Keep this timer referenced: even a hung cleanup must terminate.
      const deadline = setTimeout(() => { exitCode = 1; finish(); }, timeoutMs);
      try {
        // Stop producers/drain requests before workers, and workers before DB/Redis.
        // Each stage is bounded so a stuck resource cannot skip later cleanup.
        await stage([deps.drainHttp, deps.stopScheduler]);
        await stage([deps.closeJobs, deps.closeEmail]);
        await stage([deps.closePool, deps.closeRedis]);
      } finally {
        clearTimeout(deadline);
        finish();
      }
    })();
    return pending;
  };
}

const closeResources = createGracefulShutdown({
  drainHttp: () => new Promise<void>((resolve, reject) => {
    httpServer.close((error) => {
      if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(error);
      else resolve();
    });
    httpServer.closeIdleConnections();
  }),
  stopScheduler,
  closeJobs: async () => {
    try { await closeEditorialJobs?.(); }
    finally { await closeJobHandlers(); }
  },
  closeEmail: closeEmailQueue,
  closePool: () => pool.end(),
  closeRedis: async () => { if (redis) await redis.quit(); },
  forceClose: () => {
    for (const socket of sockets) socket.destroy();
    redis?.disconnect();
  },
  exit: (code) => process.exit(code),
}, shutdownTimeout());

function shutdown(code = 0): Promise<void> {
  shuttingDown = true;
  return closeResources(code);
}

export async function startServer(): Promise<void> {
  // Initialize background job queue (if Redis is configured)
  initializeQueues();
  initializeEmailQueue();
  registerEmailWorker();
  await registerJobHandlers();
  if (shuttingDown) return;

  const editorial = await import("./jobs/editorial");
  closeEditorialJobs = editorial.closeEditorialJobs;
  editorial.initializeEditorialJobs();
  const { registerEditorialJobsRoutes } = await import("./routes/editorial-jobs");
  registerEditorialJobsRoutes(app);

  // Initialize scheduler for cron-based pre-warming (if enabled)
  await initializeScheduler();
  if (shuttingDown) return;

  await registerRoutes(httpServer, app);
  if (shuttingDown) return;

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }
  // Last, so static/Vite errors are handled as well as API errors.
  app.use(errorHandler);
  if (shuttingDown) return;

  // Serves both the API and the client from one port.
  const port = Number.parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
}

if (process.env.NODE_ENV !== "test") {
  // EventEmitter does not observe promises returned by async listeners.
  const requestShutdown = (code = 0) => {
    void shutdown(code).catch(() => {
      console.error("[shutdown] Unexpected cleanup failure");
      process.exit(1);
    });
  };
  process.on("SIGTERM", () => requestShutdown());
  process.on("SIGINT", () => requestShutdown());
  httpServer.on("error", () => requestShutdown(1));
  void startServer().catch(() => {
    console.error("[startup] Server initialization failed");
    requestShutdown(1);
  });
}
