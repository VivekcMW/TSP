// Usage: node script/verify-offline-build.mjs [--self-test]
// Requires installed dependencies; never installs, executes the app, or reads dotenv.
// Evidence/artifacts stay private. This is local compilation, NOT deployment approval.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const self = fileURLToPath(import.meta.url);
export const root = path.resolve(path.dirname(self), '..');
const require = createRequire(import.meta.url);
const { safeEnv, expectedTsx } = require('./offline-build-guard.cjs');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (directory, name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
export function createSession() {
  const directory = fs.mkdtempSync(path.join(process.env.TSP_OFFLINE_DIR ? os.tmpdir() : '/tmp', 'tsp-offline-build-'));
  fs.chmodSync(directory, 0o700);
  fs.mkdirSync(directory + '/tmp', { mode: 0o700 });
  return directory;
}
export function runPhase(directory, name, args) {
  const fd = fs.openSync(path.join(directory, name + '.log'), 'wx', 0o600);
  const started = Date.now();
  let child;
  try {
    child = spawnSync(process.execPath, args, { cwd: root, env: safeEnv(directory, name, name === 'build'),
      detached: true, stdio: ['ignore', fd, fd] });
  } finally { fs.closeSync(fd); }
  const result = { pid: child.pid, exit: child.status, signal: child.signal, error: child.error?.code || null, durationMs: Date.now() - started };
  write(directory, name + '.result.json', result);
  return result;
}
export function assess(directory, results, required = []) {
  const logfile = directory + '/events.jsonl';
  const events = fs.existsSync(logfile) ? fs.readFileSync(logfile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const loaded = events.filter(e => e.event === 'guard-loaded');
  const denials = events.filter(e => e.event === 'denied');
  const expected = denials.filter(e => expectedTsx(e, loaded.find(g => g.pid === e.pid && g.thread === e.thread && g.phase === e.phase)));
  const unexpected = denials.filter(e => !expected.includes(e));
  const missingArtifacts = required.filter(file => !fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0);
  const children = events.filter(e => e.event === 'child');
  const guardCoverage = Object.values(results).every(r => loaded.some(g => g.pid === r.pid && g.thread === 0)) &&
    children.filter(c => c.node && c.evidence === directory).every(c => loaded.some(g => g.pid === c.childPid && g.thread === 0)) &&
    events.filter(e => e.event === 'worker').every(w => loaded.some(g => g.pid === w.pid && g.thread === w.childThread));
  const failed = r => r.exit !== 0 || !!r.signal || !!r.error;
  const childFailures = events.filter(e => ['child', 'child-exit', 'worker-exit'].includes(e.event) && 'exit' in e && failed(e));
  // Guard initialization is not proof of completion: unreferenced children can
  // outlive their spawning phase without its exit listener ever running.
  const incompleteNodeChildren = children.filter(c => c.node && c.evidence === directory &&
    !('exit' in c) && !events.some(e => e.event === 'child-exit' && e.childPid === c.childPid && e.pid === c.pid && !failed(e)));
  return { success: Object.keys(results).length > 0 && Object.values(results).every(r => !failed(r)) && guardCoverage &&
    !unexpected.length && !missingArtifacts.length && !childFailures.length && !incompleteNodeChildren.length,
    results, guardCoverage, expectedDeniedIpc: expected, unexpectedViolations: unexpected, missingArtifacts, childFailures, incompleteNodeChildren, children };
}

async function build(directory) {
  await import('tsx/esm');
  const { build: viteBuild } = await import('vite');
  const { build: esbuild } = await import('esbuild');
  const { serverBuildOptions } = await import('./build.ts');
  const options = await serverBuildOptions();
  const overrides = { configFile: root + '/vite.config.ts', configLoader: 'native', envFile: false, envDir: false,
    mode: 'production', build: { outDir: directory + '/dist/public' } };
  write(directory, 'build-options.json', { server: options, viteOverrides: overrides,
    differences: 'Only output destinations, dotenv disabling and native config loading differ; fresh scratch replaces clearing shared dist.' });
  await viteBuild(overrides);
  await esbuild({ ...options, outfile: directory + '/dist/index.cjs' });
}
function inventory(directory, relative = 'dist') {
  const folder = path.join(directory, relative);
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const name = path.join(relative, entry.name);
    return entry.isDirectory() ? inventory(directory, name) : [{ path: name, bytes: fs.statSync(path.join(directory, name)).size, sha256: hash(path.join(directory, name)) }];
  });
}
function readTestCounts(directory) {
  const tap = fs.readFileSync(directory + '/self-test.log', 'utf8');
  const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key =>
    [key, Number(new RegExp('^# ' + key + ' ([0-9]+)$', 'm').exec(tap)?.[1] ?? Number.NaN)]));
  return { counts, success: counts.tests > 0 && counts.pass === counts.tests &&
    ['fail', 'cancelled', 'skipped', 'todo'].every(key => counts[key] === 0) };
}
async function internalPhase(name) {
  if (!process.env.TSP_OFFLINE_DIR) throw new Error('Internal phase requires guard preload');
  process.chdir(root);
  if (name === 'build') await build(process.env.TSP_OFFLINE_DIR);
  else if (name === 'design') {
    await import('tsx/esm');
    process.argv.push('--check');
    await import('./generate-design-css.ts');
  } else throw new Error('Unknown internal phase');
}
async function main() {
  const mode = process.argv[2];
  if (mode === '--phase') return internalPhase(process.argv[3]);
  if (mode && mode !== '--self-test') throw new Error('Usage: node script/verify-offline-build.mjs [--self-test]');
  process.umask(0o077);
  const directory = createSession();
  console.log('Offline evidence:', directory);
  const results = {};
  let failure = null;
  const watched = ['package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'script/build.ts', 'script/generate-design-css.ts',
    'client/src/design/tokens.ts', 'client/src/design/tokens.generated.css'];
  const before = Object.fromEntries(watched.map(file => [file, hash(path.join(root, file))]));
  try {
    if (mode === '--self-test') results.selfTest = runPhase(directory, 'self-test', ['--test', root + '/test/offline-build/verification.test.mjs']);
    else {
      results.build = runPhase(directory, 'build', [self, '--phase', 'build']);
      results.design = runPhase(directory, 'design', [self, '--phase', 'design']);
      const tsc = root + '/node_modules/typescript/bin/tsc';
      results.typecheck = runPhase(directory, 'typecheck', [tsc, '--noEmit', '--incremental', 'false']);
      results.migratorTypecheck = runPhase(directory, 'migrator-typecheck', [tsc, '--noEmit', '--incremental', 'false', '--target', 'ES2022',
        '--module', 'ESNext', '--moduleResolution', 'bundler', '--strict', '--esModuleInterop', '--skipLibCheck', 'script/migrate.ts', 'script/migration-acceptance.ts']);
    }
  } catch (error) { failure = String(error); }
  const after = Object.fromEntries(watched.map(file => [file, hash(path.join(root, file))]));
  const required = mode === '--self-test' ? [] : ['dist/index.cjs', 'dist/public/index.html'].map(file => path.join(directory, file));
  const summary = assess(directory, results, required);
  const artifacts = inventory(directory);
  const inputsUnchanged = JSON.stringify(before) === JSON.stringify(after);
  const tests = mode === '--self-test' ? readTestCounts(directory) : { counts: null, success: true };
  Object.assign(summary, { success: summary.success && !failure && inputsUnchanged && tests.success, failure, mode: mode || 'build',
    node: process.version, tsx: require('tsx/package.json').version, nodeTestCounts: tests.counts, inputsUnchanged, before, after, artifacts,
    limitations: ['Node hooks are not an OS sandbox: native esbuild/addons, symlink aliases, inherited descriptors and unpatched internals lack complete coverage.',
      'Unreferenced native esbuild exit callbacks may not be observed; owning phase exit and artifact checksums are authoritative for compilation only.',
      'No full suite, transport runtime, DB, providers, staging or deployment. node:test counts are separate from Vitest.',
      'No overall acceptance/deployment approval; consult the current roadmap for external release gates.'] });
  write(directory, 'artifacts.json', artifacts);
  write(directory, 'summary.json', summary);
  console.log(JSON.stringify({ summary: directory + '/summary.json', success: summary.success, results,
    expectedDeniedIpc: summary.expectedDeniedIpc.length, unexpectedViolations: summary.unexpectedViolations.length, artifacts: artifacts.length }));
  if (!summary.success) process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); } catch (error) { console.error(error); process.exitCode = 1; }
}