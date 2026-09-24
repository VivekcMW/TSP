import { betterAuth } from "better-auth";
import { createEmailVerificationToken } from "better-auth/api";
import { pool } from "./db";
import { sendExistingAccountEmail, sendPasswordResetEmail, sendVerificationEmail } from "./services/email";
import { redis } from "./lib/redis";
import { CLIENT_IP_HEADER } from "./lib/proxy";
import { createAuthRateLimitStorage } from "./lib/proxy-rate-limit";

const baseURL = process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "http://localhost:4300";
const trustedOrigins = [baseURL];
// baseURL is the backend's own origin, but when the frontend is served from another
// origin the browser's Origin header is the FRONTEND's origin — better-auth rejects
// requests from any origin not in this list with a 403 "Invalid origin", independent of the
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

// For /api/auth-providers endpoint (backward compatibility)
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

const appOrigin = new URL(process.env.APP_URL ?? baseURL).origin;
// Anyone can type another person's address into sign-up, so notify at most hourly.
const EXISTING_SIGNUP_NOTICE_SECONDS = 3600;

async function claimExistingSignUpNotice(userId: string): Promise<boolean> {
  if (!redis) return true;
  return await redis.set(`auth:existing-signup-notice:${userId}`, "1", "EX", EXISTING_SIGNUP_NOTICE_SECONDS, "NX") === "OK";
}

/** A verified owner is told to sign in; an unverified one gets a fresh verification link. */
async function notifyExistingUserSignUp(user: { id: string; email: string; name: string; emailVerified: boolean }) {
  if (!(await claimExistingSignUpNotice(user.id))) return;
  if (user.emailVerified) {
    await sendExistingAccountEmail(user.email, user.name, `${appOrigin}/sign-in`);
    return;
  }
  const url = new URL("/api/auth/verify-email", baseURL);
  url.searchParams.set("token", await createEmailVerificationToken(process.env.BETTER_AUTH_SECRET!, user.email));
  url.searchParams.set("callbackURL", `${appOrigin}/complete-registration`);
  await sendVerificationEmail(user.email, user.name, url.toString());
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
  // Preserve Better Auth's verification provenance. A placeholder email is
  // not proof of ownership: password signups can submit the same suffix.
  // OAuth identity authentication is distinct from email verification.
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
    // Better Auth answers a duplicate sign-up exactly like a new one (no account
    // enumeration); without this hook the real owner would receive nothing.
    async onExistingUserSignUp({ user }) {
      try {
        await notifyExistingUserSignUp(user);
      } catch {
        // Never fail or delay the generic response; do not log the address.
        console.error("[auth] Could not send the existing-account notice.");
      }
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
