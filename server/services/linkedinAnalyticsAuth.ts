import type { Express as ExpressApp, NextFunction, Request, Response } from "express";
import passport from "passport";
import { Strategy as OAuth2Strategy } from "passport-oauth2";
import { storage } from "../storage";
import { encryptWebhookUrl } from "./webhookSecrets";
import { linkedInProfileOnlySnapshot, parseLinkedInAnalyticsProfile } from "./linkedinAnalyticsProfile";
import { startSocialOAuth, consumeSocialOAuth, type SocialOAuthState } from "./socialOAuthState";

/**
 * LinkedIn "Connect account" flow used by the Analytics page. This is a
 * separate feature from login/signup — it lets an already-authenticated
 * user link their LinkedIn account to pull analytics data. State is bound to
 * the initiating Better Auth session and a durable single-use tenant nonce.
 */

const LINKEDIN_SCOPES = ["openid", "profile", "email", "w_member_social"];

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
      scope: LINKEDIN_SCOPES,
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
          console.error("LinkedIn Analytics userinfo failed");
          return done(new Error(`Failed to fetch LinkedIn userinfo: ${userInfoResponse.status}`));
        }

        const userInfo = parseLinkedInAnalyticsProfile(await userInfoResponse.json());

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

  app.get("/auth/linkedin/analytics", requireAuth, async (req: Request, res: Response) => {
    // Analytics is an authenticated dashboard route. The former /analytics
    // target falls through to the dashboard overview after Clerk's route gate.
    const returnTo = "/dashboard/connections";

    const clientId = process.env.LINKEDIN_CLIENT_ID;
    if (!clientId) {
      console.error("LinkedIn Analytics OAuth: LINKEDIN_CLIENT_ID is not configured");
      return res.redirect(`${returnTo}?error=linkedin_connect_failed&reason=client_not_configured`);
    }

    const redirectUri = getOAuthCallbackUrl(
      "/auth/linkedin/analytics/callback",
      process.env.LINKEDIN_ANALYTICS_CALLBACK_URL,
    );

    const state = await startSocialOAuth(req, "linkedin");
    if (!state) return res.redirect(`${returnTo}?error=linkedin_connect_failed&reason=sign_in_and_restart_connection`);

    const authUrl =
      "https://www.linkedin.com/oauth/v2/authorization" +
      "?response_type=code" +
      `&client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(LINKEDIN_SCOPES.join(" "))}` +
      `&state=${encodeURIComponent(state)}`;

    res.redirect(authUrl);
  });

  app.get(
    "/auth/linkedin/analytics/callback",
    async (req: Request, res: Response, next: NextFunction) => {
      const statePayload = await consumeSocialOAuth(req, "linkedin");

      if (!statePayload) {
        console.error("LinkedIn Analytics Callback: invalid or expired state");
        return res.redirect("/dashboard/connections?error=linkedin_connect_failed&reason=state_mismatch_sign_in_and_restart_connection");
      }

      (req as any).linkedInAnalyticsState = statePayload;

      passport.authenticate("linkedin-analytics", {
        failureRedirect: "/dashboard/connections?error=linkedin_connect_failed",
        session: false,
      })(req, res, next);
    },
    async (req: Request, res: Response) => {
      const statePayload = (req as any).linkedInAnalyticsState as SocialOAuthState | undefined;
      const userId = statePayload?.userId;
      const tenantId = statePayload?.tenantId;
      const returnTo = "/dashboard/connections";
      const oauthData = (req as any).user;

        if (!userId || !tenantId || typeof oauthData?.profile?.id !== "string" || !oauthData.profile.id.trim() ||
          typeof oauthData.accessToken !== "string" || !oauthData.accessToken) {
        return res.redirect(`${returnTo}?error=linkedin_connect_failed`);
      }

      const scope = { tenantId, userId };

      try {
        const existing = await storage.getSocialAccountByProvider(scope, "linkedin");
        let socialAccountId: string;
        if (existing) {
          socialAccountId = existing.id;
          await storage.updateSocialAccount(scope, existing.id, {
            providerAccountId: oauthData.profile.id,
            isActive: true,
            accessToken: encryptWebhookUrl(oauthData.accessToken),
            refreshToken: oauthData.refreshToken ? encryptWebhookUrl(oauthData.refreshToken) : null,
            scopes: LINKEDIN_SCOPES,
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
            accessToken: encryptWebhookUrl(oauthData.accessToken),
            refreshToken: oauthData.refreshToken ? encryptWebhookUrl(oauthData.refreshToken) : null,
            isActive: true,
            scopes: LINKEDIN_SCOPES,
            lastSyncAt: new Date(),
          });

          socialAccountId = account.id;
        }

        await storage.createSocialAnalytics(scope, linkedInProfileOnlySnapshot(socialAccountId));

        res.redirect(`${returnTo}?connected=linkedin`);
      } catch {
        console.error("LinkedIn analytics connection error");
        res.redirect(`${returnTo}?error=linkedin_connect_failed`);
      }
    },
  );
}
