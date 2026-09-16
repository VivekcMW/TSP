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
    const [firstName = "", ...lastName] = source.name.trim().split(/\s+/);
    return {
      id: source.id,
      email: source.email,
      firstName,
      lastName: lastName.join(" "),
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
