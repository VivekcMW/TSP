import type { Express } from "express";
import type { Server } from "http";
import { requireDbUser } from "../middlewares/requireDbUser";
import { registerLinkedInAnalyticsAuth } from "../services/linkedinAnalyticsAuth";
import { registerRedditAuth } from "../services/redditAuth";
import { registerTwitterAuth } from "../services/twitterAuth";

import { registerAuthRoutes } from "./auth";
import { registerProfileRoutes } from "./profile";
import { registerAiRoutes } from "./ai";
import { registerInboxRoutes } from "./inbox";
import { registerSourcesRoutes } from "./sources";
import { registerDraftsRoutes } from "./drafts";
import { registerSocialRoutes } from "./social";
import { registerAnalyticsRoutes } from "./analytics";
import { registerAdminRoutes } from "./admin";
import { registerIntegrationsRoutes } from "./integrations";
import { registerJobsRoutes } from "./jobs";
import { registerMediaRoutes } from "./media";
import { registerBillingRoutes } from "./billing";
import { registerEmailPreferenceRoutes } from "./email-preferences";
import { registerProfileSocialLinksRoutes } from "./profile-social-links";
import { registerEditorialVoiceRoutes } from "./editorial-voice";

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
  registerRedditAuth(app, requireDbUser);
  registerTwitterAuth(app, requireDbUser);

  registerAuthRoutes(app);
  registerProfileRoutes(app);
  registerAiRoutes(app);
  registerInboxRoutes(app);
  registerSourcesRoutes(app);
  registerDraftsRoutes(app);
  registerSocialRoutes(app);
  registerAnalyticsRoutes(app);
  registerAdminRoutes(app);
  registerIntegrationsRoutes(app);
  registerJobsRoutes(app);
  registerMediaRoutes(app);
  registerBillingRoutes(app);
  registerEmailPreferenceRoutes(app);
  registerProfileSocialLinksRoutes(app);
  registerEditorialVoiceRoutes(app);

  return httpServer;
}
