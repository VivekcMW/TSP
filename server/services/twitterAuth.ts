import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { encryptWebhookUrl } from "./webhookSecrets";
import { startSocialOAuth, consumeSocialOAuth } from "./socialOAuthState";

type RequireAuth = (req: Request, res: Response, next: () => void) => void;
const SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access"];

function callbackUrl() { return process.env.TWITTER_REDIRECT_URI || `${process.env.APP_URL?.replace(/\/$/, "") || `http://localhost:${process.env.PORT || 4300}`}/auth/twitter/connect/callback`; }
function base64url(input: Buffer) { return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

/** Real OAuth 2.0 + PKCE "Connect account" flow used by the Analytics page to enable live tweet publishing (separate from Better Auth's twitter login provider). */
export function registerTwitterAuth(app: Express, requireAuth: RequireAuth) {
  app.get("/auth/twitter/connect", requireAuth, async (req: Request, res: Response) => {
    if (!process.env.TWITTER_CLIENT_ID || !process.env.TWITTER_CLIENT_SECRET) return res.redirect("/dashboard/connections?error=twitter_not_configured");
    const codeVerifier = base64url(crypto.randomBytes(48));
    const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
    const state = await startSocialOAuth(req, "twitter", { codeVerifier });
    if (!state) return res.redirect("/dashboard/connections?error=twitter_connect_failed&reason=sign_in_and_restart_connection");
    const params = new URLSearchParams({ response_type: "code", client_id: process.env.TWITTER_CLIENT_ID, redirect_uri: callbackUrl(), scope: SCOPES.join(" "), state, code_challenge: codeChallenge, code_challenge_method: "S256" });
    res.redirect(`https://x.com/i/oauth2/authorize?${params}`);
  });

  app.get("/auth/twitter/connect/callback", async (req: Request, res: Response) => {
    const state = await consumeSocialOAuth(req, "twitter");
    const code = typeof req.query.code === "string" ? req.query.code : null;
    if (!state?.codeVerifier || !code) return res.redirect("/dashboard/connections?error=twitter_connect_failed&reason=sign_in_and_restart_connection");
    try {
      const basic = Buffer.from(`${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`).toString("base64");
      const tokenResponse = await fetch("https://api.x.com/2/oauth2/token", {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callbackUrl(), code_verifier: state.codeVerifier }),
      });
      const token = (await tokenResponse.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!tokenResponse.ok || !token.access_token) throw new Error("X token exchange failed");

      const meResponse = await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url", { headers: { Authorization: `Bearer ${token.access_token}` } });
      const me = (await meResponse.json()) as { data?: { id?: string; username?: string; name?: string; profile_image_url?: string } };
      if (!meResponse.ok || !me.data?.id) throw new Error("X identity lookup failed");

      const scope = { tenantId: state.tenantId, userId: state.userId };
      const existing = await storage.getSocialAccountByProvider(scope, "twitter");
      const data = {
        provider: "twitter",
        providerAccountId: me.data.id,
        accountName: me.data.name ?? me.data.username ?? "X user",
        accountHandle: me.data.username ? `@${me.data.username}` : undefined,
        profileImageUrl: me.data.profile_image_url,
        accessToken: encryptWebhookUrl(token.access_token),
        refreshToken: token.refresh_token ? encryptWebhookUrl(token.refresh_token) : null,
        tokenExpiresAt: new Date(Date.now() + (token.expires_in ?? 7200) * 1000),
        scopes: SCOPES,
        isActive: true,
        lastSyncAt: new Date(),
      };
      if (existing) await storage.updateSocialAccount(scope, existing.id, data);
      else await storage.createSocialAccount(scope, data);

      res.redirect("/dashboard/connections?connected=twitter");
    } catch {
      console.error("X OAuth failed");
      res.redirect("/dashboard/connections?error=twitter_connect_failed");
    }
  });
}
