import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const project = fileURLToPath(new URL("../../", import.meta.url));
const mediaOnly = process.argv.includes("--media-only");
const files = mediaOnly ? [
  "server/lib/boundedPermit.test.ts",
  "server/middlewares/mediaUploadAdmission.test.ts",
  "server/routes/media.admission.test.ts",
  "server/routes/notifications-media.test.ts",
  "test/workflow-budgets/upload.test.ts",
] : [
  "test/workflow-budgets/cache.test.ts",
  "test/workflow-budgets/generation.test.ts",
  "test/workflow-budgets/ai-redis.test.ts",
  "test/workflow-budgets/upload.test.ts",
  "server/services/engines/articleCache.test.ts",
  "server/services/punditBrain.generation.test.ts",
  "server/services/generation-quota.test.ts",
  "server/services/aiProviderLimiter.test.ts",
  "server/middlewares/rateLimitRedisStore.test.ts",
  "server/routes/notifications-media.test.ts",
];

if (process.argv.includes("--isolated-child")) {
  const { startVitest } = await import("vitest/node");
  const output = process.env.WORKFLOW_BUDGET_OUTPUT;
  const ctx = await startVitest("test", files, {
    root: project, config: false, run: true, watch: false, environment: "node", include: files,
    setupFiles: [path.join(project, "test/workflow-budgets/setup.ts")],
    fileParallelism: false, maxWorkers: 1, pool: "forks",
    reporters: ["dot", "json"], outputFile: { json: path.join(output, "tests.json") },
  }, {
    envFile: false, envDir: false,
    resolve: { alias: { "@": path.join(project, "client/src"), "@shared": path.join(project, "shared") } },
  });
  await ctx?.close();
  const report = JSON.parse(readFileSync(path.join(output, "tests.json"), "utf8"));
  if (!report.success || report.testResults.length !== files.length || report.numPendingTests || report.numFailedTests) process.exitCode = 1;
} else {
  const output = mkdtempSync("/tmp/tsp-workflow-budgets-");
  // Never inherit service URLs/keys, NODE_OPTIONS, dotenv preloads, or PG* vars.
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--isolated-child", ...(mediaOnly ? ["--media-only"] : [])], {
    cwd: project, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    env: { PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", NODE_ENV: "test", TZ: "UTC",
      REDIS_URL: "", DEV_AUTH_BYPASS: "", WORKFLOW_BUDGET_OUTPUT: output },
  });
  const log = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
  writeFileSync(path.join(output, "run.log"), log);
  const metrics = [...log.matchAll(/WORKFLOW_BUDGET (\{[^\n]+\})/g)].map(match => JSON.parse(match[1]));
  writeFileSync(path.join(output, "metrics.json"), JSON.stringify(metrics, null, 2));
  const expectedMetrics = mediaOnly ? ["upload-concurrent-buffers"] : ["cache-max-payload", "shared-ai-redis", "upload-concurrent-buffers", "generation-duplicate-intents",
    "generation-max-repair", "generation-repair-with-fallback", "generation-duplicate-platforms",
    "generation-deadline", "generation-quota", "generation-unreported-usage"];
  const reportPath = path.join(output, "tests.json");
  const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : undefined;
  const complete = expectedMetrics.every(scenario => metrics.filter(value => value.scenario === scenario).length === 1);
  const summary = { success: child.status === 0 && complete && report?.success === true,
    node: process.version, platform: process.platform, arch: process.arch,
    files: report?.testResults.length ?? 0, tests: report?.numTotalTests ?? 0,
    passed: report?.numPassedTests ?? 0, failed: report?.numFailedTests ?? 0, skipped: report?.numPendingTests ?? 0,
    metricScenarios: metrics.length, productionCertification: false };
  writeFileSync(path.join(output, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  for (const value of metrics) console.log(`WORKFLOW_BUDGET ${JSON.stringify(value)}`);
  if (!summary.success) console.error(log.slice(-16_000));
  console.log(`Artifacts: ${output}`);
  process.exitCode = summary.success ? 0 : 1;
  if (child.error) console.error(child.error.message);
}