import { defineConfig } from "@playwright/test";
import { isIP } from "node:net";

function requiredOrigin(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for read-only deployment smoke`);
  const invalid = () => new Error(`${name} must be an HTTP loopback or HTTPS origin without userinfo, path, query, or fragment`);
  // Check raw syntax too: URL parsing normalizes dot paths, empty ?/#, and
  // backslashes, which must not silently turn invalid input into an origin.
  if (!/^https?:\/\/[^/?#\\\s@]+\/?$/i.test(value)) throw invalid();
  let url: URL;
  try { url = new URL(value); } catch { throw invalid(); }
  const loopback = url.hostname === "localhost" || url.hostname === "[::1]"
    || (isIP(url.hostname) === 4 && url.hostname.startsWith("127."));
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw invalid();
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw invalid();
  return url.origin;
}

// Validate both before test discovery, output setup, or any HTTP request.
const frontend = requiredOrigin("E2E_BASE_URL");
const backend = requiredOrigin("E2E_API_BASE_URL");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "deployment-smoke.spec.ts",
  metadata: { deploymentSmoke: { frontend, backend } },
  timeout: 10_000,
  globalTimeout: 120_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: { trace: "off", screenshot: "off", video: "off" },
  // Deliberately standalone: no default config, webServer, auth setup, or dotenv.
});