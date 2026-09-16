/**
 * Vercel's Upstash-for-Redis marketplace integration injects env vars
 * prefixed with the store name (e.g. `TSP_REDIS_REDIS_URL`) instead of a
 * plain `REDIS_URL` — alias it here, as the very first import in every
 * entry point, so the rest of the codebase can keep reading
 * `process.env.REDIS_URL` unchanged regardless of which store name Vercel
 * assigns.
 */
if (!process.env.REDIS_URL && process.env.TSP_REDIS_REDIS_URL) {
  process.env.REDIS_URL = process.env.TSP_REDIS_REDIS_URL;
}
