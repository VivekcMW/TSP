import { betterAuth } from "better-auth";
import { pool } from "./db";
import { sendPasswordResetEmail, sendVerificationEmail } from "./services/email";
import { redis } from "./lib/redis";
import { CLIENT_IP_HEADER } from "./lib/proxy";
import { createAuthRateLimitStorage } from "./lib/proxy-rate-limit";

const baseURL = process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "http://localhost:4300";
const trustedOrigins = [baseURL];
// baseURL is the backend's own origin (e.g. the Render URL), but in a split
// frontend/backend deployment the browser's Origin header is the FRONTEND's
// origin (e.g. the Vercel domain) — better-auth rejects requests from any
// origin not in this list with a 403 "Invalid origin", independent of the
// separate CORS allowlist in index.ts. Mirror that same allowlist here.
if (process.env.APP_URL) {
  trustedOrigins.push(process.env.APP_URL.replace(/\/$/, ""));
}
for (const origin of (process.env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean)) {
  trustedOrigins.push(origin);
}
if (process.env.NODE_ENV !== "production") {
  trustedOrigins.push(baseURL.replace("://localhost:", "://127.0.0.1:"));
}

const socialProviders = {
  ...(process.env.GOOGLE_AUTH_CLIENT_ID && process.env.GOOGLE_AUTH_CLIENT_SECRET
    ? { google: { clientId: process.env.GOOGLE_AUTH_CLIENT_ID, clientSecret: process.env.GOOGLE_AUTH_CLIENT_SECRET } }
    : {}),
  ...(process.env.LINKEDIN_AUTH_CLIENT_ID && process.env.LINKEDIN_AUTH_CLIENT_SECRET
    ? { linkedin: { clientId: process.env.LINKEDIN_AUTH_CLIENT_ID, clientSecret: process.env.LINKEDIN_AUTH_CLIENT_SECRET } }
    : {}),
  ...(process.env.TWITTER_AUTH_CLIENT_ID && process.env.TWITTER_AUTH_CLIENT_SECRET
    ? { twitter: { clientId: process.env.TWITTER_AUTH_CLIENT_ID, clientSecret: process.env.TWITTER_AUTH_CLIENT_SECRET } }
    : {}),
};

if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.trim().length < 32) {
  throw new Error("BETTER_AUTH_SECRET must be set to a secure value of at least 32 characters.");
}

if (process.env.NODE_ENV === "production" && !redis) {
  throw new Error("REDIS_URL is required for shared authentication rate limiting in production");
}

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL,
  trustedOrigins,
  socialProviders,
  advanced: {
    trustedProxyHeaders: false,
    ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
  },
  rateLimit: {
    enabled: true,
    storage: "memory",
    // customStorage overrides storage. Do NOT use secondaryStorage here:
    // that would also move sessions/verification data out of PostgreSQL.
    ...(redis ? { customStorage: createAuthRateLimitStorage(redis) } : {}),
  },
  databaseHooks: {
    user: {
      create: {
        // Providers like Twitter/X don't always return an email; Better Auth
        // substitutes a non-routable "*.placeholder.invalid" address that can
        // never receive a verification link. The provider already
        // authenticated the identity, so treat it as verified.
        async before(user) {
          if (typeof user.email === "string" && user.email.endsWith(".placeholder.invalid")) {
            return { data: { ...user, emailVerified: true } };
          }
        },
      },
    },
  },
  user: {
    modelName: "users",
    fields: {
      emailVerified: "email_verified",
      image: "profile_image_url",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  session: {
    modelName: "sessions",
    fields: { userId: "user_id", expiresAt: "expires_at", ipAddress: "ip_address", userAgent: "user_agent", createdAt: "created_at", updatedAt: "updated_at" },
  },
  account: {
    modelName: "accounts",
    fields: { accountId: "account_id", providerId: "provider_id", userId: "user_id", accessToken: "access_token", refreshToken: "refresh_token", idToken: "id_token", accessTokenExpiresAt: "access_token_expires_at", refreshTokenExpiresAt: "refresh_token_expires_at", createdAt: "created_at", updatedAt: "updated_at" },
  },
  verification: {
    modelName: "verifications",
    fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    autoSignIn: false,
    async sendResetPassword({ user, url }) {
      await sendPasswordResetEmail(user.email, user.name, url);
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    async sendVerificationEmail({ user, url }) {
      await sendVerificationEmail(user.email, user.name, url);
    },
  },
});
