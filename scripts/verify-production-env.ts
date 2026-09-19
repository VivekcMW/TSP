import "../server/lib/env-aliases";
import { validateAIConfig } from "../server/lib/ai-config-validation";
import { databasePoolConfig } from "../server/lib/db-pool-config";

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
const failures = validateAIConfig(process.env);
try { databasePoolConfig(process.env); }
catch (error) { failures.push(error instanceof Error ? error.message : "Invalid database pool configuration"); }

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
