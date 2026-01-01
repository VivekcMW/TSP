import type { Express, RequestHandler } from "express";
import session from "express-session";
import * as client from "openid-client";
import { authStorage } from "./storage";
import connectPg from "connect-pg-simple";
import { pool } from "../../db";

const PostgresSessionStore = connectPg(session);

let oidcConfig: client.Configuration | null = null;

async function getOidcConfig(): Promise<client.Configuration | null> {
  if (oidcConfig) return oidcConfig;
  
  const issuerUrl = process.env.ISSUER_URL || process.env.REPLIT_DEPLOYMENT_URL || "https://replit.com";
  const clientId = process.env.REPL_ID;
  
  if (!clientId) {
    console.warn("No REPL_ID configured - OIDC authentication disabled");
    return null;
  }

  try {
    oidcConfig = await client.discovery(
      new URL(issuerUrl),
      clientId,
      undefined,
      undefined,
      { execute: [client.allowInsecureRequests] }
    );
    return oidcConfig;
  } catch (error) {
    console.error("Failed to discover OIDC configuration:", error);
    return null;
  }
}

function getCallbackUrl(req: any): string {
  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${protocol}://${host}/api/callback`;
}

export function getSession() {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET must be set for secure session management");
  }

  const sessionStore = new PostgresSessionStore({
    pool,
    createTableIfMissing: true,
    tableName: "sessions",
  });

  return session({
    store: sessionStore,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());

  app.get("/api/login", async (req: any, res) => {
    const config = await getOidcConfig();
    if (!config) {
      return res.redirect("/login?error=auth_not_configured");
    }

    const callbackUrl = getCallbackUrl(req);
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();

    req.session.codeVerifier = codeVerifier;
    req.session.state = state;

    const authUrl = client.buildAuthorizationUrl(config, {
      redirect_uri: callbackUrl,
      scope: "openid email profile",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    });

    res.redirect(authUrl.href);
  });

  app.get("/api/callback", async (req: any, res) => {
    const config = await getOidcConfig();
    if (!config) {
      return res.redirect("/?error=auth_not_configured");
    }

    try {
      const callbackUrl = getCallbackUrl(req);
      const codeVerifier = req.session.codeVerifier;
      const expectedState = req.session.state;

      if (!codeVerifier || !expectedState) {
        return res.redirect("/login?error=session_expired");
      }

      const currentUrl = new URL(req.url, `${req.protocol}://${req.headers.host}`);
      
      const tokens = await client.authorizationCodeGrant(config, currentUrl, {
        pkceCodeVerifier: codeVerifier,
        expectedState,
      });

      const claims = tokens.claims();
      if (!claims) {
        return res.redirect("/login?error=no_claims");
      }

      const userId = claims.sub;
      const email = (claims.email as string) || `${userId}@user.replit.app`;
      const firstName = (claims.first_name as string) || (claims.given_name as string) || null;
      const lastName = (claims.last_name as string) || (claims.family_name as string) || null;
      const profileImageUrl = (claims.profile_image_url as string) || (claims.picture as string) || null;

      await authStorage.upsertUser({
        id: userId,
        email,
        firstName,
        lastName,
        profileImageUrl,
      });

      req.session.userId = userId;
      delete req.session.codeVerifier;
      delete req.session.state;

      res.redirect("/dashboard");
    } catch (error) {
      console.error("OIDC callback error:", error);
      res.redirect("/login?error=auth_failed");
    }
  });

  app.get("/api/logout", (req: any, res) => {
    req.session.destroy((err: any) => {
      res.clearCookie("connect.sid");
      res.redirect("/");
    });
  });
}

export const isAuthenticated: RequestHandler = async (req: any, res, next) => {
  const userId = req.session?.userId;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const user = await authStorage.getUser(userId);
  if (!user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  req.user = {
    ...user,
    claims: { sub: userId },
  };
  return next();
};
