import { useMemo } from "react";
import { authClient } from "./auth-client";
import { accountCache } from "./queryClient";

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  imageUrl?: string | null;
  emailVerified: boolean;
}

export function useAuth() {
  const session = authClient.useSession();
  const user = useMemo<AuthUser | null>(() => {
    const source = session.data?.user;
    if (!source) return null;
    // Use stored firstName/lastName from the database if available;
    // fall back to splitting the name field only if they're missing
    // TypeScript: Better Auth user object doesn't include firstName/lastName in type,
    // but we populate them from the database in the API response
    const firstName = (source as any).firstName || (source.name.trim().split(/\s+/)[0] || "");
    const lastName = (source as any).lastName || (source.name.trim().split(/\s+/).slice(1).join(" ") || "");
    return {
      id: source.id,
      email: source.email,
      firstName,
      lastName,
      imageUrl: source.image,
      emailVerified: source.emailVerified,
    };
  }, [session.data]);

  return { ...session, user };
}

export function useIsSignedIn(): boolean {
  return Boolean(useAuth().user);
}

export async function signOut(redirectUrl = "/") {
  await accountCache.beginSignOut();
  try {
    const result = await authClient.signOut();
    if (result.error) throw new Error(result.error.message || "Sign out failed. Please try again.");
  } finally {
    await accountCache.finishSignOut();
  }
  window.location.assign(redirectUrl);
}
