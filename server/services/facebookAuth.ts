import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { encryptWebhookUrl } from "./webhookSecrets";
import { startSocialOAuth, consumeSocialOAuth } from "./socialOAuthState";

type RequireAuth = (req: Request, res: Response, next: () => void) => void;
const SCOPES = ["pages_show_list", "pages_manage_posts", "pages_read_engagement"];
const GRAPH_API = "https://graph.facebook.com/v25.0";

function callbackUrl() { return process.env.FACEBOOK_REDIRECT_URI || `${process.env.APP_URL?.replace(/\/$/, "") || `http://localhost:${process.env.PORT || 4300}`}/auth/facebook/connect/callback`; }

/** Real OAuth 2.0 "Connect account" flow that picks the first Facebook Page the user manages and stores its page-scoped token for direct publishing. */
export function registerFacebookAuth(app: Express, requireAuth: RequireAuth) {
  app.get("/auth/facebook/connect", requireAuth, async (req: Request, res: Response) => {
    if (!process.env.FACEBOOK_CLIENT_ID || !process.env.FACEBOOK_CLIENT_SECRET) return res.redirect("/dashboard/connections?error=facebook_not_configured");
    const state = await startSocialOAuth(req, "facebook");
    if (!state) return res.redirect("/dashboard/connections?error=facebook_connect_failed&reason=sign_in_and_restart_connection");
    const params = new URLSearchParams({ client_id: process.env.FACEBOOK_CLIENT_ID, redirect_uri: callbackUrl(), scope: SCOPES.join(","), response_type: "code", state });
    res.redirect(`https://www.facebook.com/v25.0/dialog/oauth?${params}`);
  });

  app.get("/auth/facebook/connect/callback", async (req: Request, res: Response) => {
    const state = await consumeSocialOAuth(req, "facebook");
    const code = typeof req.query.code === "string" ? req.query.code : null;
    if (!state || !code) return res.redirect("/dashboard/connections?error=facebook_connect_failed&reason=sign_in_and_restart_connection");
    try {
      const tokenParams = new URLSearchParams({ client_id: process.env.FACEBOOK_CLIENT_ID!, client_secret: process.env.FACEBOOK_CLIENT_SECRET!, redirect_uri: callbackUrl(), code });
      const tokenResponse = await fetch(`${GRAPH_API}/oauth/access_token?${tokenParams}`);
      const token = await tokenResponse.json() as { access_token?: string };
      if (!tokenResponse.ok || !token.access_token) throw new Error("Facebook token exchange failed");

      // Exchange for a long-lived user token first, so the page token derived from it also lasts.
      const longLivedParams = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: process.env.FACEBOOK_CLIENT_ID!, client_secret: process.env.FACEBOOK_CLIENT_SECRET!, fb_exchange_token: token.access_token });
      const longLivedResponse = await fetch(`${GRAPH_API}/oauth/access_token?${longLivedParams}`);
      const longLived = await longLivedResponse.json() as { access_token?: string };
      const userToken = longLivedResponse.ok && longLived.access_token ? longLived.access_token : token.access_token;

      const pagesResponse = await fetch(`${GRAPH_API}/me/accounts?access_token=${encodeURIComponent(userToken)}`);
      const pages = await pagesResponse.json() as { data?: Array<{ id?: string; name?: string; access_token?: string }> };
      const page = pages.data?.[0];
      if (!pagesResponse.ok || !page?.id || !page.access_token) throw new Error("No manageable Facebook Page was found");

      const scope = { tenantId: state.tenantId, userId: state.userId };
      const existing = await storage.getSocialAccountByProvider(scope, "facebook");
      const data = {
        provider: "facebook",
        providerAccountId: page.id,
        accountName: page.name ?? "Facebook Page",
        accountHandle: page.name,
        accessToken: encryptWebhookUrl(page.access_token),
        refreshToken: null,
        tokenExpiresAt: null,
        scopes: SCOPES,
        isActive: true,
        lastSyncAt: new Date(),
      };
      if (existing) await storage.updateSocialAccount(scope, existing.id, data);
      else await storage.createSocialAccount(scope, data);
      res.redirect("/dashboard/connections?connected=facebook");
    } catch {
      console.error("Facebook OAuth failed");
      res.redirect("/dashboard/connections?error=facebook_connect_failed");
    }
  });
}
