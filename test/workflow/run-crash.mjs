// Focused explicit allowlist. Full suite remains the parent acceptance task.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { validateWorkflowEnvironment } from './environment.mjs';
const target = validateWorkflowEnvironment(process.env);
if (process.env.WORKFLOW_CRASH_TESTS !== 'true' || target.host !== '127.0.0.1' || target.port !== 60053
  || target.database !== 'thesocialpundit_acceptance_test' || new URL(process.env.OWNER_TEST_DATABASE_URL).username !== 'vivekanandchoudhari') throw new Error('Explicit retained isolated crash target required');
const root = fileURLToPath(new URL('../../', import.meta.url));
const guardLog = resolve(root, 'test-results/workflow-crash-blocked.log');
if (process.argv[2] !== '--isolated-child') {
  mkdirSync(resolve(root, 'test-results'), { recursive: true }); rmSync(guardLog, { force: true });
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'SystemRoot'].flatMap(k => process.env[k] ? [[k, process.env[k]]] : []));
  Object.assign(env, { WORKFLOW_DB_TESTS: 'true', WORKFLOW_CRASH_TESTS: 'true', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
    OWNER_TEST_DATABASE_URL: process.env.OWNER_TEST_DATABASE_URL, DATABASE_URL: process.env.TEST_DATABASE_URL, NODE_ENV: 'test', TZ: 'UTC',
    BETTER_AUTH_SECRET: 'workflow-only-auth-secret-not-a-real-credential', BETTER_AUTH_URL: 'http://127.0.0.1:4300', APP_URL: 'http://127.0.0.1:4300',
    WEBHOOK_ENCRYPTION_SECRET: 'workflow-only-encryption-secret-32-characters', PUBLISHING_MODE: 'sandbox', DB_POOL_MAX: '4', DB_CONNECTION_TIMEOUT_MS: '2000',
    WORKFLOW_GUARD_LOG: guardLog, NODE_OPTIONS: `--require=${resolve(root, 'test/workflow/crash-guard.cjs')}` });
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--isolated-child'], { cwd: root, env, stdio: 'inherit', detached: true });
  process.exitCode = child.status ?? 1;
  if (existsSync(guardLog) && readFileSync(guardLog, 'utf8').trim()) process.exitCode = 1;
} else {
  const { startVitest } = await import('vitest/node');
  const reportPath = resolve(root, 'test-results/workflow-crash-acceptance.json'); rmSync(reportPath, { force: true });
  const files = ['test/workflow/crash.test.ts', 'test/workflow/composed.test.ts'];
  const ctx = await startVitest('test', files, { root, config: false, run: true, include: files, setupFiles: [], fileParallelism: false,
    maxWorkers: 1, testTimeout: 30000, hookTimeout: 30000, reporters: ['default', 'json'], outputFile: reportPath },
  { envFile: false, envDir: false, resolve: { alias: { '@shared': resolve(root, 'shared'), '@': resolve(root, 'client/src') } } });
  await ctx?.close();
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  console.log(JSON.stringify({ success: report.success, files: report.testResults.length, passed: report.numPassedTests, failed: report.numFailedTests, pending: report.numPendingTests }));
  if (!report.success || report.testResults.length !== 2 || report.numPassedTests !== 17 || report.numFailedTests || report.numPendingTests) process.exitCode = 1;
}