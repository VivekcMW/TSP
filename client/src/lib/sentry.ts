import * as Sentry from "@sentry/react";

/** Optional: absent VITE_SENTRY_DSN means monitoring is off, not a build failure. */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.PROD ? "production" : "development",
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 0,
  });
}

export { Sentry };
