import { useMemo } from "react";
import { authClient } from "./auth-client";

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
  await authClient.signOut();
  window.location.assign(redirectUrl);
}
