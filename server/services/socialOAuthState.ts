import crypto from "node:crypto";
import type { Request } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../authentication";
import { storage } from "../storage";
import { resolveTenantContext } from "./tenancy";
import { can } from "./permissions";
import { z } from "zod";

const TTL = 10 * 60_000;
const stateSchema = z.object({
  v: z.literal(1), provider: z.enum(["twitter", "reddit", "linkedin"]),
  userId: z.string().min(1), tenantId: z.string().min(1),
  nonce: z.string().regex(/^[a-f0-9]{64}$/), exp: z.number().int(),
  codeVerifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/).optional(),
  subreddit: z.string().regex(/^\w{3,21}$/).optional(),
}).strict();
export type SocialOAuthState = z.infer<typeof stateSchema>;
type Provider = SocialOAuthState["provider"];
function secret() {
  const value = process.env.OAUTH_STATE_SECRET;
  if (!value || value.trim().length < 32) throw new Error("Configure OAUTH_STATE_SECRET with at least 32 characters");
  return value;
}
function mac(value: string) { return crypto.createHmac("sha256", secret()).update(value).digest("hex"); }
function digest(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }

async function context(req: Request, tenantId: string, userId: string, provider: Provider) {
  // Never trust req.id, Passport's req.user, or a dev-auth synthetic identity.
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers), query: { disableCookieCache: true } });
  const expiresAt = session ? new Date(session.session.expiresAt).getTime() : NaN;
  if (!session?.session.id || session.user.id !== userId || session.session.userId !== userId ||
    !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  const user = await storage.getUser(userId);
  if (!user?.emailVerified) return null;
  const header = req.headers["x-tenant-id"];
  if (header !== undefined && (typeof header !== "string" || header.trim() !== tenantId)) return null;
  if (req.tenant && (req.tenant.tenantId !== tenantId || req.dbUser?.id !== userId)) return null;
  // Top-level provider redirects have no tenant header. Explicit signed-tenant
  // lookup is essential: never substitute the personal tenant on callback.
  const tenant = await resolveTenantContext(userId, tenantId);
  if (tenant?.tenantId !== tenantId || tenant.userId !== userId || tenant.viaPlatformRole || !can(tenant, "social:connect:own")) return null;
  return { scope: { tenantId, userId }, sessionBinding: mac(JSON.stringify(["social-oauth-session-v1", provider, tenantId, userId, session.session.id])) };
}

export async function startSocialOAuth(req: Request, provider: Provider, extra: { codeVerifier?: string; subreddit?: string } = {}): Promise<string | null> {
  try {
    if (!req.dbUser || !req.tenant) return null; // Must follow requireAuth.
    const ctx = await context(req, req.tenant.tenantId, req.dbUser.id, provider);
    if (!ctx) return null;
    const state = stateSchema.parse({ ...extra, ...ctx.scope, provider, v: 1, nonce: crypto.randomBytes(32).toString("hex"), exp: Date.now() + TTL });
    const body = Buffer.from(JSON.stringify(state)).toString("base64url");
    const signature = mac(`social-oauth-state-v1:${body}`);
    const value = `${body}.${signature}`;
    await storage.createSocialOAuthState(ctx.scope, { provider, stateDigest: digest(value), sessionBinding: ctx.sessionBinding, expiresAt: new Date(state.exp) });
    return value;
  } catch { return null; }
}

export async function consumeSocialOAuth(req: Request, provider: Provider): Promise<SocialOAuthState | null> {
  try {
    const value = req.query.state;
    if (typeof value !== "string" || value.length > 4096 || req.query.error || typeof req.query.code !== "string" || !req.query.code.trim()) return null;
    const parts = value.split(".");
    if (parts.length !== 2 || !/^[a-f0-9]{64}$/.test(parts[1])) return null;
    const expected = mac(`social-oauth-state-v1:${parts[0]}`);
    if (!crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expected))) return null;
    const state = stateSchema.parse(JSON.parse(Buffer.from(parts[0], "base64url").toString()));
    if (state.provider !== provider || state.exp <= Date.now() || state.exp > Date.now() + TTL ||
      (provider === "twitter" && !state.codeVerifier) || (provider === "reddit" && !state.subreddit)) return null;
    const ctx = await context(req, state.tenantId, state.userId, provider);
    if (!ctx) return null; // Unauthorized attempts must not consume valid state.
    return await storage.consumeSocialOAuthState(ctx.scope, { provider, stateDigest: digest(value), sessionBinding: ctx.sessionBinding }) ? state : null;
  } catch { return null; } // DB/session/config failure: no provider exchange.
}