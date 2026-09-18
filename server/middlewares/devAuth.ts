import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, type User } from "@shared/models/auth";
import { ensurePersonalTenant } from "../services/tenancy";
import { storage } from "../storage";

/**
 * Local-development authentication bypass.
 *
 * TEMPORARY. This exists only so the app can be worked on before Clerk login
 * is working, and must be removed once real sign-in is integrated. While it is
 * enabled there is NO authentication: every request is treated as the same
 * seeded user.
 *
 * Two independent conditions must both hold for it to activate:
 *   1. NODE_ENV !== "production"
 *   2. DEV_AUTH_BYPASS === "true"  (opt-in; absent means off)
 *
 * Setting the flag under NODE_ENV=production refuses to boot rather than
 * silently shipping an unauthenticated API.
 */

const FLAG_SET = process.env.DEV_AUTH_BYPASS === "true";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

if (IS_PRODUCTION && FLAG_SET) {
  throw new Error(
    "DEV_AUTH_BYPASS=true with NODE_ENV=production. Refusing to start: this " +
      "flag disables authentication entirely and is for local development only.",
  );
}

export const devAuthEnabled = !IS_PRODUCTION && FLAG_SET;

export const DEV_USER_ID = "dev-user-local";
const DEV_EMAIL = process.env.DEV_AUTH_EMAIL || "dev@localhost";

if (devAuthEnabled) {
  console.warn(
    "\n" +
      "  ============================================================\n" +
      "   DEV_AUTH_BYPASS is ON - authentication is DISABLED.\n" +
      `   Every request runs as ${DEV_EMAIL} (${DEV_USER_ID}).\n` +
      "   Never enable this outside local development.\n" +
      "  ============================================================\n",
  );
}

let cachedUser: User | undefined;

/**
 * Returns the seeded local user, creating it on first use.
 *
 * Onboarding is marked as not-started so the dev user goes through the
 * profile setup flow for testing purposes.
 */
export async function resolveDevUser(): Promise<User> {
  if (cachedUser) {
    console.log("[devAuth] Returning cached dev user");
    return cachedUser;
  }

  console.log("[devAuth] Creating/seeding dev user...");

  const insertResult = await db
    .insert(users)
    .values({
      id: DEV_USER_ID,
      email: DEV_EMAIL,
      name: "Local Developer",
      firstName: "Local",
      lastName: "Developer",
      country: "India",
      industry: "media_advertising",
      registrationCompleted: new Date(),
    })
    .onConflictDoNothing();

  console.log("[devAuth] Insert result:", insertResult);

  const tenantId = await ensurePersonalTenant(DEV_USER_ID, "Local Developer");
  console.log("[devAuth] Created/ensured tenant:", tenantId);

  // Through the repository, not a raw insert. The repository sets
  // app.tenant_id transaction-locally, which the Row-Level Security policy on
  // user_profiles requires; a direct insert is rejected by WITH CHECK. RLS
  // caught this exact bypass the first time the app ran as the restricted role.
  const scope = { tenantId, userId: DEV_USER_ID };
  
  // Check if profile exists
  const existingProfile = await storage.getUserProfile(scope);
  console.log("[devAuth] Existing profile:", existingProfile?.onboardingStatus);

  if (!existingProfile) {
    console.log("[devAuth] Creating new profile with not-started status");
    await storage.createUserProfile(scope, {
      onboardingStatus: "not-started",
      focusDescription: "Seeded local development profile.",
      publications: [],
      keywords: [
        { keyword: "advertising", weight: 0.8 },
        { keyword: "media", weight: 0.8 },
        { keyword: "marketing", weight: 0.7 },
      ],
      influencers: [],
      companies: [],
    });
  } else if (existingProfile.onboardingStatus !== "not-started") {
    console.log("[devAuth] Updating existing profile to not-started status");
    await storage.updateUserProfile(scope, {
      onboardingStatus: "not-started",
    });
  }

  const [user] = await db.select().from(users).where(eq(users.id, DEV_USER_ID)).limit(1);

  if (!user) {
    throw new Error("Failed to seed the DEV_AUTH_BYPASS user");
  }

  console.log("[devAuth] Dev user ready:", user.id, user.email);
  cachedUser = user;
  return user;
}
