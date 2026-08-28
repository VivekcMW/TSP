import { useUser } from "@clerk/react";

/**
 * TEMPORARY local-development login bypass.
 *
 * Pairs with the server's DEV_AUTH_BYPASS (see server/middlewares/devAuth.ts).
 * Both sides must be enabled, and both are inert in production:
 * `import.meta.env.DEV` is substituted at build time, so this condition is
 * dead-code-eliminated from a production bundle.
 *
 * Remove this file once real Clerk sign-in works.
 */
export const devAuthEnabled =
  import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS === "true";

/**
 * Whether to treat the visitor as signed in.
 *
 * Use this instead of Clerk's `isSignedIn` anywhere that gates data fetching or
 * authenticated UI. Clerk's own value stays false under the bypass, which would
 * otherwise leave every dashboard query disabled and the pages blank.
 */
export function useIsSignedIn(): boolean {
  const { isSignedIn } = useUser();
  return devAuthEnabled || !!isSignedIn;
}
