// Deliberately independent of vite.config, test/setup, dotenv and Playwright config.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { validateWorkflowEnvironment } from './environment.mjs';
export { validateWorkflowEnvironment } from './environment.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
validateWorkflowEnvironment(process.env);
if (process.argv[2] !== '--isolated-child') {
  // Allowlist, not an inherited spread: no real provider credentials, PG* overrides,
  // NODE_OPTIONS preloads, dev auth, configured Redis or live publishing mode.
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'SystemRoot'].flatMap(k => process.env[k] ? [[k, process.env[k]]] : []));
  Object.assign(env, {
    WORKFLOW_DB_TESTS: 'true', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
    OWNER_TEST_DATABASE_URL: process.env.OWNER_TEST_DATABASE_URL,
    DATABASE_URL: process.env.TEST_DATABASE_URL, NODE_ENV: 'test', TZ: 'UTC',
    BETTER_AUTH_SECRET: 'workflow-only-auth-secret-not-a-real-credential',
    BETTER_AUTH_URL: 'http://127.0.0.1:4300', APP_URL: 'http://127.0.0.1:4300',
    WEBHOOK_ENCRYPTION_SECRET: 'workflow-only-encryption-secret-32-characters',
    PUBLISHING_MODE: 'sandbox', DB_POOL_MAX: '4', DB_CONNECTION_TIMEOUT_MS: '2000',
  });
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--isolated-child'], { cwd: root, env, stdio: 'inherit' });
  process.exitCode = child.status ?? 1;
} else {
  const { startVitest } = await import('vitest/node');
  const { readFileSync, rmSync } = await import('node:fs');
  const reportPath = resolve(root, 'test-results/workflow-acceptance.json');
  // Never accept a prior run's success if collection fails before writing JSON.
  rmSync(reportPath, { force: true });
  const files = ['test/workflow/composed.test.ts'];
  const ctx = await startVitest('test', files, {
    root, config: false, run: true, include: files, setupFiles: [], fileParallelism: false,
    maxWorkers: 1, testTimeout: 20000, hookTimeout: 30000,
    reporters: ['default', 'json'], outputFile: reportPath,
  }, { envFile: false, envDir: false, resolve: { alias: {
    '@shared': resolve(root, 'shared'), '@': resolve(root, 'client/src'),
  } } });
  await ctx?.close();
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  if (!report.success || report.testResults.length !== files.length || !report.numPassedTests || report.numPendingTests) process.exitCode = 1;
}