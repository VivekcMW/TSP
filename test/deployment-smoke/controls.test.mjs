import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run only: node --test test/deployment-smoke/controls.test.mjs
// No app imports, env-file loads, database, browser, or external HTTP calls.
const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve("@playwright/test/package.json")), "cli.js");
const config = join(root, "playwright.deployment.config.ts");
const html = '<!doctype html><html><body><div id="root"></div></body></html>';
const paths = ["/healthz", "/readyz", "/api/drafts", "/api/integrations"];
const expectedRequests = [
  ...paths.map((path) => `backend ${path}`),
  ...[...paths, "/sign-in"].map((path) => `frontend ${path}`),
].sort();

async function mock(t, target, mode, requests) {
  const server = createServer((req, res) => {
    requests.push({ target, path: req.url, method: req.method,
      cookie: req.headers.cookie, authorization: req.headers.authorization });
    res.setHeader("Set-Cookie", "smoke-canary=must-not-be-reused; Path=/");
    const isPrivate = req.url.startsWith("/api/");
    const isProbe = req.url === "/healthz" || req.url === "/readyz";
    res.setHeader("Content-Type", "application/json");
    if (mode === "redirect") {
      res.writeHead(302, { Location: "/must-not-follow" });
      return res.end();
    }
    if (mode === "timeout" && req.url === "/readyz") return;
    if (mode === "html-fallback" && isProbe) {
      res.setHeader("Content-Type", "text/html");
      return res.end(html);
    }
    if (req.url === "/sign-in") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(mode === "missing-root" ? "<html><body>Fallback</body></html>" : html);
    }
    if (isPrivate) {
      res.statusCode = mode === "private-200" ? 200 : mode === "private-404" ? 404
        : req.url === "/api/drafts" ? 401 : 403;
      return res.end(JSON.stringify({ message: "mock anonymous boundary" }));
    }
    if (req.url === "/readyz") {
      res.statusCode = mode === "ready-503" ? 503 : 200;
      return res.end(JSON.stringify({ status: mode === "bad-status" ? "error" : "ok",
        database: mode === "bad-database" ? "error" : "ok",
        queue: { available: false }, jobsRequired: false }));
    }
    if (req.url === "/healthz") {
      return res.end(JSON.stringify({ status: mode === "bad-status" ? "error" : "ok" }));
    }
    res.statusCode = 404;
    res.end();
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  assert.ok(![4300, 4302].includes(server.address().port));
  return `http://127.0.0.1:${server.address().port}`;
}

async function run(t, mode = "normal", overrides = {}, { list = false, optOut = false } = {}) {
  const scratch = await mkdtemp(join(tmpdir(), "tsp-deployment-smoke-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const requests = [];
  const frontend = await mock(t, "frontend", mode, requests);
  const backend = await mock(t, "backend", mode, requests);
  // An allowlist, never {...process.env}: no inherited auth, proxies, NODE_OPTIONS,
  // dotenv settings, DB URLs, provider keys, reporters or Playwright overrides.
  const env = { PATH: dirname(process.execPath), HOME: scratch, TMPDIR: scratch,
    CI: "1", NO_COLOR: "1", E2E_BASE_URL: frontend, E2E_API_BASE_URL: backend,
    ...overrides };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  // A config-less directory exercises the suite's default opt-out without
  // importing the root config's app-starting webServer. All other runs use
  // the exact dedicated config, not a reconstructed test configuration.
  const args = [cli, "test", `--config=${optOut ? join(root, "e2e") : config}`,
    "deployment-smoke.spec.ts", "--reporter=json",
    `--output=${join(scratch, "results")}`, ...(list ? ["--list"] : [])];
  const result = await new Promise((resolve) => {
    execFile(process.execPath, args, { cwd: root, env, timeout: 60_000,
      killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, signal: error?.signal, stdout, stderr });
    });
  });
  assert.ok(!result.signal, result.stderr);
  assert.equal(typeof result.code, "number", result.stderr);
  return { ...result, requests };
}

for (const [mode, failures] of [
  ["normal", 0], ["ready-503", 2], ["html-fallback", 4], ["private-200", 4],
  ["private-404", 4], ["redirect", 9], ["bad-status", 4], ["bad-database", 2],
  ["missing-root", 1], ["timeout", 2],
]) {
  test(`dedicated CLI: ${mode} (${failures} expected failures)`, { timeout: 65_000 }, async (t) => {
    const result = await run(t, mode);
    assert.equal(result.code, failures ? 1 : 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.errors.length, 0);
    assert.equal(report.stats.expected, 9 - failures);
    assert.equal(report.stats.unexpected, failures);
    assert.equal(report.stats.skipped, 0);
    assert.equal(report.stats.flaky, 0);
    assert.equal(report.config.workers, 1);
    assert.equal(report.config.webServer, null);
    assert.equal(report.config.projects[0].retries, 0);
    assert.deepEqual(result.requests.map((req) => `${req.target} ${req.path}`).sort(), expectedRequests);
    for (const req of result.requests) {
      assert.equal(req.method, "GET");
      assert.equal(req.cookie, undefined);
      assert.equal(req.authorization, undefined);
    }
    t.diagnostic(`CLI exit=${result.code}; passed=${report.stats.expected}; failed=${report.stats.unexpected}; skipped=0; anonymous GETs=${result.requests.length}`);
  });
}

for (const key of ["E2E_BASE_URL", "E2E_API_BASE_URL"]) {
  test(`missing ${key} fails before HTTP`, async (t) => {
    const result = await run(t, "normal", { [key]: undefined });
    assert.equal(result.code, 1);
    assert.match(result.stderr + result.stdout, new RegExp(`${key} is required`));
    assert.deepEqual(result.requests, []);
  });
}

for (const value of [
  "http://remote.invalid", "ftp://127.0.0.1", "https://user:pass@remote.invalid",
  "https://remote.invalid/path", "https://remote.invalid/..", "https://remote.invalid?",
  "https://remote.invalid#", "https://remote.invalid\\path", " https://remote.invalid",
]) {
  test(`invalid origin rejected before HTTP: ${value}`, async (t) => {
    const result = await run(t, "normal", { E2E_API_BASE_URL: value }, { list: true });
    assert.equal(result.code, 1);
    assert.match(result.stderr + result.stdout, /E2E_API_BASE_URL must be/);
    assert.deepEqual(result.requests, []);
  });
}

test("HTTPS remote and IPv6 loopback origins accepted by discovery only (no HTTP)", async (t) => {
  const result = await run(t, "normal", {
    E2E_BASE_URL: "https://frontend.invalid/", E2E_API_BASE_URL: "http://[::1]:12345",
  }, { list: true });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).errors.length, 0);
  assert.deepEqual(result.requests, []);
});

for (const value of [undefined, "not-an-origin"]) {
  test(`without dedicated opt-in: ${value ?? "missing"} env explicitly skips`, async (t) => {
    const result = await run(t, "normal", {
      E2E_BASE_URL: value, E2E_API_BASE_URL: value,
    }, { optOut: true });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.errors.length, 0);
    assert.equal(report.stats.skipped, 9);
    assert.equal(report.stats.expected, 0);
    assert.equal(report.stats.unexpected, 0);
    assert.deepEqual(result.requests, []);
    t.diagnostic("No opt-in: 9 skipped, 0 passed, 0 failed, 0 HTTP requests");
  });
}