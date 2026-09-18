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
 * Both registration and onboarding are marked complete so the client gate
 * lands on the dashboard. That matters because the onboarding wizard calls
 * /api/ai/analyze-identity, so without a Gemini key it cannot be completed
 * by hand — an unfinished profile would leave the app stuck on the wizard.
 */
export async function resolveDevUser(): Promise<User> {
  if (cachedUser) return cachedUser;

  await db
    .insert(users)
    .values({
      id: DEV_USER_ID,
      email: DEV_EMAIL,
      firstName: "Local",
      lastName: "Developer",
      country: "India",
      industry: "media_advertising",
      registrationCompleted: new Date(),
    })
    .onConflictDoNothing();

  const tenantId = await ensurePersonalTenant(DEV_USER_ID, "Local Developer");

  // Through the repository, not a raw insert. The repository sets
  // app.tenant_id transaction-locally, which the Row-Level Security policy on
  // user_profiles requires; a direct insert is rejected by WITH CHECK. RLS
  // caught this exact bypass the first time the app ran as the restricted role.
  const scope = { tenantId, userId: DEV_USER_ID };
  if (!(await storage.getUserProfile(scope))) {
    await storage.createUserProfile(scope, {
      onboardingStatus: "completed",
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
  }

  const [user] = await db.select().from(users).where(eq(users.id, DEV_USER_ID)).limit(1);

  if (!user) {
    throw new Error("Failed to seed the DEV_AUTH_BYPASS user");
  }

  cachedUser = user;
  return user;
}
