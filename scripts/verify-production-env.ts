import "../server/lib/env-aliases";

const required = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "APP_URL",
  "ALLOWED_ORIGINS",
  "OAUTH_STATE_SECRET",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "REDIS_URL",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
];

const missing = required.filter((name) => !process.env[name]?.trim());
const failures: string[] = [];

if (!process.env.OPENROUTER_API_KEY?.trim() && !process.env.GEMINI_API_KEY?.trim() && !process.env.AI_INTEGRATIONS_GEMINI_API_KEY?.trim()) {
  failures.push("OPENROUTER_API_KEY, GEMINI_API_KEY, or AI_INTEGRATIONS_GEMINI_API_KEY must be configured");
}

if (process.env.NODE_ENV !== "production") failures.push("NODE_ENV must be production");
if (process.env.DEV_AUTH_BYPASS === "true") failures.push("DEV_AUTH_BYPASS must not be true");
if (process.env.PUBLISHING_MODE !== "live") failures.push("PUBLISHING_MODE must be live");
if (process.env.BACKGROUND_JOBS_ENABLED !== "true") failures.push("BACKGROUND_JOBS_ENABLED must be true");
if (process.env.PROCESS_ROLE === "scheduler" && process.env.CRON_SCHEDULER !== "true") failures.push("CRON_SCHEDULER must be true on the scheduler instance");
if (process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_SECRET.length < 32) failures.push("BETTER_AUTH_SECRET must be at least 32 characters");

if (missing.length || failures.length) {
  if (missing.length) console.error(`Missing production variables: ${missing.join(", ")}`);
  for (const failure of failures) console.error(`Production configuration error: ${failure}`);
  process.exit(1);
}

console.log("Production environment configuration is present and passes safety checks.");
