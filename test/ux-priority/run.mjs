import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const project = fileURLToPath(new URL("../../", import.meta.url));
// Exact filters AND includes, no root Vitest config or database setup.
const allFiles = [
  "test/integration-security/app.browser.test.ts",
  "test/integration-security/cache.test.ts",
  "client/src/components/dashboard/create-post-state.test.ts",
  "client/src/components/dashboard/editorial-generation.test.ts",
  "client/src/components/dashboard/create-post-transitions.browser.test.ts",
  "client/src/lib/create-story-link.test.ts",
  "client/src/lib/editorial-recovery.test.ts",
  "shared/editorial.test.ts",
  "client/src/lib/editorial.test.ts",
  "client/src/lib/publishing.test.ts",
  "client/src/lib/platform-handoff.test.ts",
  "client/src/pages/publishing-ux.test.ts",
  "client/src/pages/page-adoption.test.ts",
  "server/services/publishing-policy.test.ts",
  "client/src/components/dashboard/draft-reconciliation.browser.test.ts",
  "server/storage.draft-revision.mock.test.ts",
  "server/storage.publishing-consent.mock.test.ts",
  "server/services/email/theme-rendering.test.ts",
  "server/routes/drafts.scheduling.test.ts",
  "client/src/design/contrast.test.ts",
  "client/src/design/foundation-primitives.test.ts",
  "client/src/design/foundations.browser.test.ts",
  "client/src/design/field-alignment.browser.test.ts",
  "client/src/design/palette.browser.test.ts",
  "client/src/design/palette.test.ts",
];
const designOnly = process.argv.includes("--design-only");
const selectionArgs = process.argv.slice(2).filter(arg => arg === "--design-only" || arg.startsWith("--only="));
const selectedFiles = selectionArgs.filter(arg => arg.startsWith("--only=")).map(arg => arg.slice("--only=".length));
if ((designOnly && selectedFiles.length) || selectedFiles.some(file => !allFiles.includes(file))) {
  throw new Error("Choose --design-only or --only=<exact allowlisted file>; arbitrary test paths are not allowed");
}
const files = designOnly ? allFiles.filter(file => file.startsWith("client/src/design/"))
  : selectedFiles.length ? allFiles.filter(file => selectedFiles.includes(file)) : allFiles;
const validReport = report => report?.success === true && report.numTotalTests > 0 &&
  !report.numFailedTests && !report.numPendingTests && !report.numTodoTests &&
  !report.numFailedTestSuites && report.testResults.length === files.length &&
  files.every(file => report.testResults.some(result => result.name === path.join(project, file) &&
    result.status === "passed" && result.assertionResults.length > 0 &&
    result.assertionResults.every(test => test.status === "passed")));

if (process.argv.includes("--isolated-child")) {
  const { startVitest } = await import("vitest/node");
  const output = process.env.UX_PRIORITY_TEST_OUTPUT;
  if (!output) throw new Error("Missing isolated artifact directory");
  const ctx = await startVitest("test", files, {
    root: project, config: false, run: true, watch: false, include: files,
    environment: "node", setupFiles: [], fileParallelism: false,
    maxWorkers: 1, pool: "forks", testTimeout: 20_000, hookTimeout: 60_000,
    reporters: ["dot", "json"], outputFile: { json: path.join(output, "tests.json") },
  }, {
    envFile: false, envDir: false, esbuild: { jsx: "automatic" },
    resolve: { alias: { "@": path.join(project, "client/src"), "@shared": path.join(project, "shared") } },
  });
  await ctx?.close();
  const report = JSON.parse(readFileSync(path.join(output, "tests.json"), "utf8"));
  if (!validReport(report)) process.exitCode = 1;
} else {
  const output = mkdtempSync("/tmp/tsp-ux-priority-");
  const logFile = path.join(output, "run.log");
  const log = openSync(logFile, "w");
  // Separate process group avoids another agent's terminal Ctrl-C. Still wait
  // synchronously; only this child's fixtures are started and closed by tests.
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--isolated-child", ...selectionArgs], {
    cwd: project, detached: true, stdio: ["ignore", log, log],
    // No credentials, database/Redis URLs, dotenv preloads or NODE_OPTIONS.
    env: { PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", NODE_ENV: "test", TZ: "UTC",
      REDIS_URL: "", DEV_AUTH_BYPASS: "", UX_PRIORITY_TEST_OUTPUT: output },
  });
  closeSync(log);
  const reportFile = path.join(output, "tests.json");
  const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, "utf8")) : undefined;
  const summary = {
    success: child.status === 0 && validReport(report), childExitStatus: child.status, childSignal: child.signal,
    files: report?.testResults.length ?? 0, tests: report?.numTotalTests ?? 0,
    passed: report?.numPassedTests ?? 0, failed: report?.numFailedTests ?? 0,
    skipped: report?.numPendingTests ?? 0, todo: report?.numTodoTests ?? 0,
    results: report?.testResults.map(result => ({ file: path.relative(project, result.name),
      passed: result.assertionResults.filter(test => test.status === "passed").length,
      failed: result.assertionResults.filter(test => test.status === "failed").length })),
    reportFile, productionCertification: false,
    limitations: ["Chromium only; touch-capable taps and horizontal wheel emulation, not real-device swipes",
      "Mocked authentication/APIs; generation, saving and upload requests are intercepted, no backend, DB, Redis or external network",
      "System fallback fonts; no external font downloads or screen-reader certification",
      "Exact-file UX and mocked publishing-policy acceptance; real database concurrency and production acceptance are separate"],
  };
  writeFileSync(path.join(output, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Artifacts: ${output}`);
  if (!summary.success) console.error(readFileSync(logFile, "utf8").slice(-24_000));
  if (child.error) console.error(child.error.message);
  process.exitCode = summary.success ? 0 : 1;
}