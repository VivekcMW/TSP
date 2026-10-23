import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { encryptWebhookUrl } from "./webhookSecrets";
import { startSocialOAuth, consumeSocialOAuth } from "./socialOAuthState";

type RequireAuth = (req: Request, res: Response, next: () => void) => void;
const SCOPES = ["threads_basic", "threads_content_publish"];

function callbackUrl() { return process.env.THREADS_REDIRECT_URI || `${process.env.APP_URL?.replace(/\/$/, "") || `http://localhost:${process.env.PORT || 4300}`}/auth/threads/connect/callback`; }

/** Real OAuth 2.0 "Connect account" flow for Meta's Threads API (its own Meta app/login, separate from Facebook Login). */
export function registerThreadsAuth(app: Express, requireAuth: RequireAuth) {
  app.get("/auth/threads/connect", requireAuth, async (req: Request, res: Response) => {
    if (!process.env.THREADS_CLIENT_ID || !process.env.THREADS_CLIENT_SECRET) return res.redirect("/dashboard/connections?error=threads_not_configured");
    const state = await startSocialOAuth(req, "threads");
    if (!state) return res.redirect("/dashboard/connections?error=threads_connect_failed&reason=sign_in_and_restart_connection");
    const params = new URLSearchParams({ client_id: process.env.THREADS_CLIENT_ID, redirect_uri: callbackUrl(), scope: SCOPES.join(","), response_type: "code", state });
    res.redirect(`https://threads.com/oauth/authorize?${params}`);
  });

  app.get("/auth/threads/connect/callback", async (req: Request, res: Response) => {
    const state = await consumeSocialOAuth(req, "threads");
    const code = typeof req.query.code === "string" ? req.query.code : null;
    if (!state || !code) return res.redirect("/dashboard/connections?error=threads_connect_failed&reason=sign_in_and_restart_connection");
    try {
      const form = new URLSearchParams({ client_id: process.env.THREADS_CLIENT_ID!, client_secret: process.env.THREADS_CLIENT_SECRET!, grant_type: "authorization_code", redirect_uri: callbackUrl(), code });
      const tokenResponse = await fetch("https://graph.threads.com/oauth/access_token", { method: "POST", body: form });
      const token = await tokenResponse.json() as { access_token?: string; user_id?: number };
      if (!tokenResponse.ok || !token.access_token || !token.user_id) throw new Error("Threads token exchange failed");

      const longLivedParams = new URLSearchParams({ grant_type: "th_exchange_token", client_secret: process.env.THREADS_CLIENT_SECRET!, access_token: token.access_token });
      const longLivedResponse = await fetch(`https://graph.threads.net/access_token?${longLivedParams}`);
      const longLived = await longLivedResponse.json() as { access_token?: string; expires_in?: number };
      if (!longLivedResponse.ok || !longLived.access_token) throw new Error("Threads long-lived token exchange failed");

      const profileResponse = await fetch(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${encodeURIComponent(longLived.access_token)}`);
      const profile = await profileResponse.json() as { id?: string; username?: string };
      if (!profileResponse.ok || !profile.id) throw new Error("Threads identity lookup failed");

      const scope = { tenantId: state.tenantId, userId: state.userId };
      const existing = await storage.getSocialAccountByProvider(scope, "threads");
      const data = {
        provider: "threads",
        providerAccountId: profile.id,
        accountName: profile.username ?? "Threads user",
        accountHandle: profile.username ? `@${profile.username}` : undefined,
        accessToken: encryptWebhookUrl(longLived.access_token),
        refreshToken: null,
        tokenExpiresAt: longLived.expires_in ? new Date(Date.now() + longLived.expires_in * 1000) : null,
        scopes: SCOPES,
        isActive: true,
        lastSyncAt: new Date(),
      };
      if (existing) await storage.updateSocialAccount(scope, existing.id, data);
      else await storage.createSocialAccount(scope, data);
      res.redirect("/dashboard/connections?connected=threads");
    } catch {
      console.error("Threads OAuth failed");
      res.redirect("/dashboard/connections?error=threads_connect_failed");
    }
  });
}
