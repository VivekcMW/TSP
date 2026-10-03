import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const project = fileURLToPath(new URL("../../", import.meta.url));
// Exact filters AND includes: never fall through to the root database setup.
const files = [
  "server/services/openRouter.deadline.test.ts",
  "server/services/openRouter.regression.test.ts",
  "server/services/aiProvider.test.ts",
  "server/services/aiDiagnostics.test.ts",
  "server/services/aiProviderLimiter.test.ts",
  "server/services/aiProviderLimiter.redis.test.ts",
  "test/workflow-budgets/ai-redis.test.ts",
  "server/services/punditBrain.deadline.test.ts",
  "server/services/punditBrain.generation.test.ts",
  "server/services/punditBrain.evidence.test.ts",
  "server/services/editorial-request.deadline.test.ts",
  "server/services/editorial-request.index.test.ts",
  "server/services/editorial-progress.test.ts",
  "server/services/editorial-voice-claims.test.ts",
  "server/jobs/editorial.deadline.test.ts",
  "server/jobs/editorial.test.ts",
  "server/jobs/editorial.billing.test.ts",
  "server/jobs/editorial.configuration.test.ts",
];

if (process.argv.includes("--isolated-child")) {
  const { startVitest } = await import("vitest/node");
  const output = process.env.RELIABILITY_TEST_OUTPUT;
  const ctx = await startVitest("test", files, {
    root: project, config: false, run: true, watch: false, include: files,
    environment: "node", setupFiles: [path.join(project, "test/workflow-budgets/setup.ts")],
    fileParallelism: false, maxWorkers: 1, pool: "forks",
    reporters: ["dot", "json"], outputFile: { json: path.join(output, "tests.json") },
  }, {
    envFile: false, envDir: false,
    resolve: { alias: { "@": path.join(project, "client/src"), "@shared": path.join(project, "shared") } },
  });
  await ctx?.close();
  const report = JSON.parse(readFileSync(path.join(output, "tests.json"), "utf8"));
  if (!report.success || report.testResults.length !== files.length || report.numFailedTests || report.numPendingTests) process.exitCode = 1;
} else {
  const output = mkdtempSync("/tmp/tsp-generation-reliability-");
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--isolated-child"], {
    cwd: project, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    // No credentials, service URLs, dotenv preloads or NODE_OPTIONS inherited.
    env: { PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", NODE_ENV: "test", TZ: "UTC",
      REDIS_URL: "", DEV_AUTH_BYPASS: "", RELIABILITY_TEST_OUTPUT: output },
  });
  const log = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
  writeFileSync(path.join(output, "run.log"), log);
  const reportFile = path.join(output, "tests.json");
  const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, "utf8")) : undefined;
  const summary = { success: child.status === 0 && report?.success === true && report?.testResults.length === files.length,
    files: report?.testResults.length ?? 0, tests: report?.numTotalTests ?? 0, passed: report?.numPassedTests ?? 0,
    failed: report?.numFailedTests ?? 0, skipped: report?.numPendingTests ?? 0, productionCertification: false };
  writeFileSync(path.join(output, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  console.log(`Artifacts: ${output}`);
  if (!summary.success) console.error(log.slice(-16_000));
  if (child.error) console.error(child.error.message);
  process.exitCode = summary.success ? 0 : 1;
}