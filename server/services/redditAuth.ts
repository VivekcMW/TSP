import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { encryptWebhookUrl } from "./webhookSecrets";
import { startSocialOAuth, consumeSocialOAuth } from "./socialOAuthState";

type RequireAuth = (req: Request, res: Response, next: () => void) => void;
const SCOPES = ["identity", "submit"];

function callbackUrl() { return process.env.REDDIT_REDIRECT_URI || `${process.env.APP_URL?.replace(/\/$/, "") || `http://localhost:${process.env.PORT || 4300}`}/auth/reddit/callback`; }

export function registerRedditAuth(app: Express, requireAuth: RequireAuth) {
  app.get("/auth/reddit", requireAuth, async (req, res) => {
    if (!process.env.REDDIT_CLIENT_ID || !process.env.REDDIT_CLIENT_SECRET) return res.redirect("/dashboard/connections?error=reddit_not_configured");
    const subreddit = typeof req.query.subreddit === "string" ? req.query.subreddit.replace(/^r\//, "") : "";
    if (!/^[A-Za-z0-9_]{3,21}$/.test(subreddit)) return res.redirect("/dashboard/connections?error=reddit_subreddit_required");
    const state = await startSocialOAuth(req, "reddit", { subreddit });
    if (!state) return res.redirect("/dashboard/connections?error=reddit_connect_failed&reason=sign_in_and_restart_connection");
    const params = new URLSearchParams({ client_id: process.env.REDDIT_CLIENT_ID, response_type: "code", state, redirect_uri: callbackUrl(), duration: "permanent", scope: SCOPES.join(" ") });
    res.redirect(`https://www.reddit.com/api/v1/authorize?${params}`);
  });

  app.get("/auth/reddit/callback", async (req, res) => {
    const state = await consumeSocialOAuth(req, "reddit");
    const code = typeof req.query.code === "string" ? req.query.code : null;
    if (!state?.subreddit || !code) return res.redirect("/dashboard/connections?error=reddit_connect_failed&reason=sign_in_and_restart_connection");
    try {
      const basic = Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString("base64");
      const tokenResponse = await fetch("https://www.reddit.com/api/v1/access_token", { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "TheSocialPundit/1.0" }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callbackUrl() }) });
      const token = await tokenResponse.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!tokenResponse.ok || !token.access_token) throw new Error("Reddit token exchange failed");
      const meResponse = await fetch("https://oauth.reddit.com/api/v1/me", { headers: { Authorization: `Bearer ${token.access_token}`, "User-Agent": "TheSocialPundit/1.0" } });
      const me = await meResponse.json() as { id?: string; name?: string };
      if (!meResponse.ok || !me.id) throw new Error("Reddit identity lookup failed");
      const scope = { tenantId: state.tenantId, userId: state.userId }; const existing = await storage.getSocialAccountByProvider(scope, "reddit");
      const data = { provider: "reddit", providerAccountId: me.id, accountName: me.name ?? "Reddit user", accountHandle: state.subreddit, accessToken: encryptWebhookUrl(token.access_token), refreshToken: token.refresh_token ? encryptWebhookUrl(token.refresh_token) : null, tokenExpiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000), scopes: SCOPES, isActive: true, lastSyncAt: new Date() };
      if (existing) await storage.updateSocialAccount(scope, existing.id, data); else await storage.createSocialAccount(scope, data);
      res.redirect("/dashboard/connections?connected=reddit");
    } catch { console.error("Reddit OAuth failed"); res.redirect("/dashboard/connections?error=reddit_connect_failed"); }
  });
}
