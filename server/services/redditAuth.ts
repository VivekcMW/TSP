import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { encryptWebhookUrl } from "./webhookSecrets";

type RequireAuth = (req: Request, res: Response, next: () => void) => void;
type State = { userId: string; tenantId: string; subreddit: string; exp: number };
const SCOPES = ["identity", "submit"];

function callbackUrl() { return process.env.REDDIT_REDIRECT_URI || `${process.env.APP_URL?.replace(/\/$/, "") || `http://localhost:${process.env.PORT || 4300}`}/auth/reddit/callback`; }
function secret() { const value = process.env.OAUTH_STATE_SECRET; if (!value) throw new Error("OAUTH_STATE_SECRET must be configured"); return value; }
function sign(state: State) { const body = Buffer.from(JSON.stringify(state)).toString("base64url"); return `${body}.${crypto.createHmac("sha256", secret()).update(body).digest("base64url")}`; }
function verify(value: string): State | null { const [body, signature] = value.split("."); if (!body || !signature) return null; const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url"); if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null; try { const state = JSON.parse(Buffer.from(body, "base64url").toString()) as State; return state.exp > Date.now() && /^[A-Za-z0-9_]{3,21}$/.test(state.subreddit) ? state : null; } catch { return null; } }

export function registerRedditAuth(app: Express, requireAuth: RequireAuth) {
  app.get("/auth/reddit", requireAuth, (req: any, res) => {
    if (!process.env.REDDIT_CLIENT_ID || !process.env.REDDIT_CLIENT_SECRET) return res.redirect("/dashboard/connections?error=reddit_not_configured");
    const subreddit = typeof req.query.subreddit === "string" ? req.query.subreddit.replace(/^r\//, "") : "";
    if (!/^[A-Za-z0-9_]{3,21}$/.test(subreddit)) return res.redirect("/dashboard/connections?error=reddit_subreddit_required");
    const state = sign({ userId: req.dbUser.id, tenantId: req.tenant.tenantId, subreddit, exp: Date.now() + 10 * 60 * 1000 });
    const params = new URLSearchParams({ client_id: process.env.REDDIT_CLIENT_ID, response_type: "code", state, redirect_uri: callbackUrl(), duration: "permanent", scope: SCOPES.join(" ") });
    res.redirect(`https://www.reddit.com/api/v1/authorize?${params}`);
  });

  app.get("/auth/reddit/callback", async (req, res) => {
    const state = typeof req.query.state === "string" ? verify(req.query.state) : null;
    const code = typeof req.query.code === "string" ? req.query.code : null;
    if (!state || !code || req.query.error) return res.redirect("/dashboard/connections?error=reddit_connect_failed");
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
    } catch (error) { console.error("Reddit OAuth failed:", error); res.redirect("/dashboard/connections?error=reddit_connect_failed"); }
  });
}
