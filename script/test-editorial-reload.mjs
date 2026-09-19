// Dedicated acceptance runner: no dotenv, project config, inherited provider keys,
// migrations or shared suites. Only the retained isolated target is permitted.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import { validateWorkflowEnvironment } from '../test/workflow/environment.mjs';

const target = validateWorkflowEnvironment(process.env);
if (process.env.EDITORIAL_RELOAD_BROWSER_TESTS !== 'true' || target.host !== '127.0.0.1' || target.port !== 60053 || target.database !== 'thesocialpundit_acceptance_test') {
  throw new Error('Requires EDITORIAL_RELOAD_BROWSER_TESTS=true and the exact isolated 127.0.0.1:60053 target');
}
const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv[2] !== '--isolated-child') {
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'SystemRoot'].flatMap(k => process.env[k] ? [[k, process.env[k]]] : []));
  Object.assign(env, {
    WORKFLOW_DB_TESTS: 'true', EDITORIAL_RELOAD_BROWSER_TESTS: 'true',
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL, OWNER_TEST_DATABASE_URL: process.env.OWNER_TEST_DATABASE_URL,
    DATABASE_URL: process.env.TEST_DATABASE_URL, NODE_ENV: 'test', TZ: 'UTC',
    BETTER_AUTH_SECRET: 'workflow-only-auth-secret-not-a-real-credential',
    WEBHOOK_ENCRYPTION_SECRET: 'workflow-only-encryption-secret-32-characters',
    PUBLISHING_MODE: 'sandbox', DB_POOL_MAX: '4', DB_CONNECTION_TIMEOUT_MS: '2000',
  });
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--isolated-child'], { cwd: root, env, stdio: 'inherit', detached: true });
  process.exitCode = child.status ?? 1;
} else {
  const { startVitest } = await import('vitest/node');
  const reportPath = resolve(root, 'test-results/editorial-reload-browser.json');
  rmSync(reportPath, { force: true });
  const files = ['test/editorial-reload.browser.test.ts'];
  const ctx = await startVitest('test', files, {
    root, config: false, run: true, include: files, setupFiles: [], fileParallelism: false, maxWorkers: 1,
    testTimeout: 60000, hookTimeout: 60000, reporters: ['default', 'json'], outputFile: reportPath,
  }, { envFile: false, envDir: false, resolve: { alias: { '@shared': resolve(root, 'shared'), '@': resolve(root, 'client/src') } } });
  await ctx?.close();
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  console.log(JSON.stringify({ success: report.success, files: report.testResults.length, passed: report.numPassedTests, failed: report.numFailedTests, pending: report.numPendingTests }));
  if (!report.success || report.testResults.length !== 1 || report.numPassedTests !== 9 || report.numFailedTests || report.numPendingTests) process.exitCode = 1;
}