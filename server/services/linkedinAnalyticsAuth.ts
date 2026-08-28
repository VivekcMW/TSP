import crypto from "crypto";
import type { Express as ExpressApp, NextFunction, Request, Response } from "express";
import passport from "passport";
import { Strategy as OAuth2Strategy } from "passport-oauth2";
import { storage } from "../storage";

/**
 * LinkedIn "Connect account" flow used by the Analytics page. This is a
 * separate feature from login/signup — it lets an already-authenticated
 * user link their LinkedIn account to pull analytics data. Kept alive as
 * its own module during the Clerk migration since Clerk only replaces
 * login/session auth, not this app-specific OAuth "connect" feature.
 *
 * Replit Auth stored the CSRF `state` / return context in the server
 * session (express-session). Since express-session is removed as part of
 * the Clerk migration, this uses a stateless, HMAC-signed `state`
 * parameter instead, so no session middleware is required.
 */

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface LinkedInAnalyticsStatePayload {
  userId: string;
  /**
   * The tenant the user was acting in when the flow started. Carried through
   * the signed state so the resulting connection lands in the right tenant
   * rather than defaulting to the personal one.
   */
  tenantId: string;
  returnTo: string;
  nonce: string;
  exp: number;
}

function getStateSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET;
  if (!secret) {
    throw new Error("OAUTH_STATE_SECRET must be set to sign LinkedIn Analytics OAuth state");
  }
  return secret;
}

function signState(payload: LinkedInAnalyticsStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", getStateSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyState(state: string): LinkedInAnalyticsStatePayload | null {
  const [body, signature] = state.split(".");
  if (!body || !signature) return null;

  const expectedSignature = crypto.createHmac("sha256", getStateSecret()).update(body).digest("base64url");
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (signatureBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(signatureBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LinkedInAnalyticsStatePayload;
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
    if (typeof payload.userId !== "string" || typeof payload.returnTo !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

// Prioritises: 1) explicit env override, 2) APP_URL, 3) localhost on the
// configured port. Previously fell back to CANONICAL_HOST and REPLIT_DOMAINS,
// both of which went away with the Replit decoupling, and hardcoded port 5000
// in the localhost case regardless of PORT.
function getOAuthCallbackUrl(path: string, envOverride?: string): string {
  if (envOverride) return envOverride;

  const appUrl = process.env.APP_URL?.replace(/\/$/, "");
  if (appUrl) return `${appUrl}${path}`;

  return `http://localhost:${process.env.PORT || 3000}${path}`;
}

function generateDemoAnalyticsMetrics(provider: string) {
  const baseFollowers = provider === "linkedin" ? 2500 : 1800;
  const variance = () => Math.floor(Math.random() * 200) - 100;

  const metrics = {
    followers: baseFollowers + variance(),
    following: provider === "linkedin" ? 450 + variance() : 320 + variance(),
    posts: 24 + Math.floor(Math.random() * 10),
    impressions: 12400 + Math.floor(Math.random() * 3000),
    engagements: 520 + Math.floor(Math.random() * 200),
    engagementRate: parseFloat((4.2 + Math.random() * 2).toFixed(2)),
    likes: 340 + Math.floor(Math.random() * 100),
    comments: 45 + Math.floor(Math.random() * 30),
    shares: 28 + Math.floor(Math.random() * 20),
    clicks: 156 + Math.floor(Math.random() * 50),
    profileViews: provider === "linkedin" ? 89 + Math.floor(Math.random() * 40) : undefined,
  };

  const topPosts = [
    {
      postId: `post_${Date.now()}_1`,
      content:
        provider === "linkedin"
          ? "The future of B2B marketing isn't about more content—it's about better context. Here's what I learned from analyzing 500+ campaigns..."
          : "Hot take: Most SaaS companies are over-engineering their onboarding. Simple wins. Here's why...",
      impressions: 3200 + Math.floor(Math.random() * 1000),
      engagements: 180 + Math.floor(Math.random() * 50),
      likes: 120 + Math.floor(Math.random() * 30),
      comments: 24 + Math.floor(Math.random() * 10),
      shares: 18 + Math.floor(Math.random() * 8),
      postedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      postId: `post_${Date.now()}_2`,
      content:
        provider === "linkedin"
          ? "Just shipped a major feature after 3 months of work. The key insight? Listen to users, not just their words, but their behaviors."
          : "Thread: 5 counterintuitive lessons from scaling to $10M ARR. Let's go...",
      impressions: 2800 + Math.floor(Math.random() * 800),
      engagements: 145 + Math.floor(Math.random() * 40),
      likes: 95 + Math.floor(Math.random() * 25),
      comments: 18 + Math.floor(Math.random() * 8),
      shares: 12 + Math.floor(Math.random() * 6),
      postedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      postId: `post_${Date.now()}_3`,
      content:
        provider === "linkedin"
          ? "AI won't replace marketers. But marketers who use AI will replace those who don't. Here's my stack for 2026..."
          : "Unpopular opinion: Most productivity advice is just procrastination in disguise.",
      impressions: 2100 + Math.floor(Math.random() * 600),
      engagements: 98 + Math.floor(Math.random() * 30),
      likes: 72 + Math.floor(Math.random() * 20),
      comments: 12 + Math.floor(Math.random() * 6),
      shares: 8 + Math.floor(Math.random() * 4),
      postedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];

  return { metrics, topPosts };
}

type RequireAuthMiddleware = (req: Request, res: Response, next: NextFunction) => void;

export function registerLinkedInAnalyticsAuth(app: ExpressApp, requireAuth: RequireAuthMiddleware) {
  if (!process.env.LINKEDIN_CLIENT_ID || !process.env.LINKEDIN_CLIENT_SECRET) {
    return;
  }

  // Needed for passport.authenticate() to work; no passport.session() since
  // this flow never relies on a passport-managed login session.
  app.use(passport.initialize());

  const linkedinAnalyticsCallbackURL = getOAuthCallbackUrl(
    "/auth/linkedin/analytics/callback",
    process.env.LINKEDIN_ANALYTICS_CALLBACK_URL,
  );
  console.log("LinkedIn Analytics OAuth callback URL:", linkedinAnalyticsCallbackURL);

  const linkedinAuthURL = "https://www.linkedin.com/oauth/v2/authorization";
  const linkedinTokenURL = "https://www.linkedin.com/oauth/v2/accessToken";
  const linkedinUserInfoURL = "https://api.linkedin.com/v2/userinfo";

  const linkedinAnalyticsStrategy = new OAuth2Strategy(
    {
      authorizationURL: linkedinAuthURL,
      tokenURL: linkedinTokenURL,
      clientID: process.env.LINKEDIN_CLIENT_ID,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
      callbackURL: linkedinAnalyticsCallbackURL,
      scope: "openid profile email",
    } as any,
    async (accessToken: string, refreshToken: string, _params: any, _profile: any, done: any) => {
      try {
        const userInfoResponse = await fetch(linkedinUserInfoURL, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        });

        if (!userInfoResponse.ok) {
          const errorText = await userInfoResponse.text();
          console.error("LinkedIn Analytics userinfo error:", userInfoResponse.status, errorText);
          return done(new Error(`Failed to fetch LinkedIn userinfo: ${userInfoResponse.status}`));
        }

        const userInfo = await userInfoResponse.json();

        const profileData = {
          id: userInfo.sub,
          displayName: userInfo.name || `${userInfo.given_name || ""} ${userInfo.family_name || ""}`.trim(),
          name: {
            givenName: userInfo.given_name,
            familyName: userInfo.family_name,
          },
          emails: userInfo.email ? [{ value: userInfo.email }] : [],
          photos: userInfo.picture ? [{ value: userInfo.picture }] : [],
        };

        done(null, { accessToken, refreshToken, profile: profileData });
      } catch (error) {
        done(error);
      }
    },
  );

  linkedinAnalyticsStrategy.name = "linkedin-analytics";
  passport.use(linkedinAnalyticsStrategy);
  console.log("LinkedIn Analytics OAuth strategy configured (OIDC)");

  app.get("/auth/linkedin/analytics", requireAuth, (req: any, res: Response) => {
    const userId = req.dbUser.id;
    const rawReturnTo = (req.query.returnTo as string) || req.headers.referer || "/analytics";
    const returnTo = rawReturnTo.includes("/dashboard") ? "/dashboard" : "/analytics";

    const clientId = process.env.LINKEDIN_CLIENT_ID;
    if (!clientId) {
      console.error("LinkedIn Analytics OAuth: LINKEDIN_CLIENT_ID is not configured");
      return res.redirect(`${returnTo}?error=linkedin_connect_failed&reason=client_not_configured`);
    }

    const redirectUri = getOAuthCallbackUrl(
      "/auth/linkedin/analytics/callback",
      process.env.LINKEDIN_ANALYTICS_CALLBACK_URL,
    );

    const state = signState({
      userId,
      tenantId: req.tenant.tenantId,
      returnTo,
      nonce: crypto.randomUUID(),
      exp: Date.now() + STATE_TTL_MS,
    });

    const authUrl =
      "https://www.linkedin.com/oauth/v2/authorization" +
      "?response_type=code" +
      `&client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      "&scope=openid%20profile%20email" +
      `&state=${encodeURIComponent(state)}`;

    res.redirect(authUrl);
  });

  app.get(
    "/auth/linkedin/analytics/callback",
    (req: Request, res: Response, next: NextFunction) => {
      if (req.query.error) {
        console.error("LinkedIn Analytics Callback: Error from LinkedIn:", {
          error: req.query.error,
          error_description: req.query.error_description,
        });
        return res.redirect(
          `/analytics?error=linkedin_connect_failed&reason=${encodeURIComponent(
            (req.query.error_description as string) || (req.query.error as string),
          )}`,
        );
      }

      const incomingState = req.query.state as string | undefined;
      const statePayload = incomingState ? verifyState(incomingState) : null;

      if (!statePayload) {
        console.error("LinkedIn Analytics Callback: invalid or expired state");
        return res.redirect("/analytics?error=linkedin_connect_failed&reason=state_mismatch");
      }

      (req as any).linkedInAnalyticsState = statePayload;

      passport.authenticate("linkedin-analytics", {
        failureRedirect: `${statePayload.returnTo}?error=linkedin_connect_failed`,
        session: false,
      })(req, res, next);
    },
    async (req: Request, res: Response) => {
      const statePayload = (req as any).linkedInAnalyticsState as LinkedInAnalyticsStatePayload | undefined;
      const userId = statePayload?.userId;
      const tenantId = statePayload?.tenantId;
      const returnTo = statePayload?.returnTo || "/analytics";
      const oauthData = (req as any).user;

      if (!userId || !tenantId || !oauthData?.profile) {
        return res.redirect(`${returnTo}?error=linkedin_connect_failed`);
      }

      const scope = { tenantId, userId };

      try {
        const existing = await storage.getSocialAccountByProvider(scope, "linkedin");
        if (existing) {
          await storage.updateSocialAccount(scope, existing.id, {
            accessToken: oauthData.accessToken,
            refreshToken: oauthData.refreshToken || null,
            lastSyncAt: new Date(),
          });
        } else {
          const displayName =
            oauthData.profile.displayName ||
            `${oauthData.profile.name?.givenName || ""} ${oauthData.profile.name?.familyName || ""}`.trim() ||
            "LinkedIn User";

          const account = await storage.createSocialAccount(scope, {
            provider: "linkedin",
            providerAccountId: oauthData.profile.id,
            accountName: displayName,
            accountHandle: `@${oauthData.profile.id}`,
            accessToken: oauthData.accessToken,
            refreshToken: oauthData.refreshToken || null,
            isActive: true,
            scopes: ["openid", "profile", "email"],
            lastSyncAt: new Date(),
          });

          const demoMetrics = generateDemoAnalyticsMetrics("linkedin");
          await storage.createSocialAnalytics(scope, {
            socialAccountId: account.id,
            provider: "linkedin",
            snapshotDate: new Date(),
            metrics: demoMetrics.metrics,
            topPosts: demoMetrics.topPosts,
          });
        }

        res.redirect(`${returnTo}?connected=linkedin`);
      } catch (error) {
        console.error("LinkedIn analytics connection error", error);
        res.redirect(`${returnTo}?error=linkedin_connect_failed`);
      }
    },
  );
}
