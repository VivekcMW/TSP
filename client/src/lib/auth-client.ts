import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // The build-time prerender (entry-server.tsx) imports this module without a window; it never
  // sends requests, so any absolute origin will do there.
  baseURL: typeof window === "undefined" ? "http://localhost" : window.location.origin,
});
