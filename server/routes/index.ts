import type { Express } from "express";
import type { Server } from "http";
import { requireDbUser } from "../middlewares/requireDbUser";
import { registerLinkedInAnalyticsAuth } from "../services/linkedinAnalyticsAuth";

import { registerAuthRoutes } from "./auth";
import { registerProfileRoutes } from "./profile";
import { registerAiRoutes } from "./ai";
import { registerInboxRoutes } from "./inbox";
import { registerDraftsRoutes } from "./drafts";
import { registerSocialRoutes } from "./social";
import { registerAnalyticsRoutes } from "./analytics";

/**
 * Mounts the HTTP API.
 *
 * This was one 977-line routes.ts. The split is by resource, and the
 * registration order below matches the original file's order because Express
 * matches routes in registration order — most visibly, /api/analytics/summary
 * must be registered before /api/analytics/:provider or the literal path would
 * be swallowed by the parameterised one.
 */
export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  registerLinkedInAnalyticsAuth(app, requireDbUser);

  registerAuthRoutes(app);
  registerProfileRoutes(app);
  registerAiRoutes(app);
  registerInboxRoutes(app);
  registerDraftsRoutes(app);
  registerSocialRoutes(app);
  registerAnalyticsRoutes(app);

  return httpServer;
}
