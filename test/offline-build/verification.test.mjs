// Standalone node:test suite: no Vitest setup, DB fixtures or application imports.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createSession, runPhase, assess } from '../../script/verify-offline-build.mjs';
const require = createRequire(import.meta.url);
const { safeEnv, expectedTsx } = require('../../script/offline-build-guard.cjs');
const sentinel = "process.env.TSP_OFFLINE_DIR + '/.env.nonexistent'";
const probes = {
  'env sync': `require('node:fs').readFileSync(${sentinel})`,
  'env callback': `require('node:fs').readFile(${sentinel}, () => {})`,
  'env promise': `require('node:fs/promises').readFile(${sentinel})`,
  'env open': `require('node:fs').openSync(${sentinel}, 'r')`,
  'env promise open': `require('node:fs/promises').open(${sentinel}, 'r')`,
  'env stream': `require('node:fs').createReadStream(${sentinel})`,
  'env Buffer path': `require('node:fs').readFileSync(Buffer.from(${sentinel}))`,
  'env URL path': `require('node:fs').readFileSync(require('node:url').pathToFileURL(${sentinel}))`,
  'env native loader': `process.loadEnvFile(${sentinel})`,
  'directory removal outside scratch': "require('node:fs').rmdirSync(require('node:path').dirname(process.env.TSP_OFFLINE_DIR) + '/tsp-offline-nonexistent-directory')",
  'dotenv caught internally': `require(${JSON.stringify(require.resolve('dotenv'))}).config({path: ${sentinel}, quiet: true})`,
  'net IPv4': "require('node:net').connect({host:'127.0.0.1',port:5433})",
  'net IPv6': "require('node:net').connect({host:'::1',port:5432})",
  'net Unix': "require('node:net').connect(process.env.TSP_OFFLINE_DIR + '/nonexistent.sock')",
  'net listen': "require('node:net').createServer().listen(0)",
  TLS: "require('node:tls').connect({host:'sentinel.invalid',port:443})",
  DNS: "require('node:dns').lookup('sentinel.invalid',()=>{})",
  'DNS promise': "require('node:dns/promises').resolve4('sentinel.invalid')",
  'DNS resolver': "new (require('node:dns/promises').Resolver)().resolveTxt('sentinel.invalid')",
  UDP: "require('node:dgram').createSocket('udp4').send(Buffer.from('x'),9,'192.0.2.1')",
  'native executable': "require('node:child_process').spawnSync('/bin/sh', ['-c', 'exit 0'])",
  'shell option': "require('node:child_process').spawnSync(process.execPath, ['-e', ''], {shell:true})",
  'child env-file option': `require('node:child_process').spawnSync(process.execPath, ['--env-file='+(${sentinel}), '-e', ''])`,
  'child optional env-file option': `require('node:child_process').spawnSync(process.execPath, ['--env-file-if-exists='+(${sentinel}), '-e', ''])`,
  'child short preload option': "require('node:child_process').spawnSync(process.execPath, ['-r/nonexistent', '-e', ''])",
  'child journal redirection': "require('node:child_process').spawnSync(process.execPath, ['-e', ''], {env:{TSP_OFFLINE_DIR:process.env.TSP_OFFLINE_DIR+'/tmp',TSP_OFFLINE_PHASE:'self-test'}})",
};
for (const [name, action] of Object.entries(probes)) test(name + ' denied before I/O, even if swallowed', () => {
  const directory = createSession();
  const code = `(async()=>{try{await (${action})}catch(e){if(e.code!=='TSP_OFFLINE_DENIED') throw e}})()`;
  const result = runPhase(directory, 'probe', ['-e', code]);
  assert.equal(result.exit, 0, fs.readFileSync(directory + '/probe.log', 'utf8'));
  const summary = assess(directory, { probe: result });
  assert.equal(summary.success, false);
  assert.equal(summary.guardCoverage, true);
  assert.equal(summary.unexpectedViolations.length, 1);
});
test('allowlisted environment drops injected secrets, loaders, proxies and build flags', () => {
  const directory = createSession();
  const env = safeEnv(directory);
  assert.deepEqual(Object.keys(env).sort(), ['HOME','NODE_ENV','NODE_OPTIONS','PATH','TMPDIR','TSP_OFFLINE_DIR','TSP_OFFLINE_PHASE','TSX_DISABLE_CACHE','TZ'].sort());
  const code = `const {spawnSync}=require('node:child_process');
    const injected={DATABASE_URL:'sentinel',VITE_SECRET:'sentinel',NODE_OPTIONS:'--require=/nonexistent',HTTP_PROXY:'sentinel'};
    Object.assign(process.env,injected);
    for(const options of [{},{env:injected}]) {
      const c=spawnSync(process.execPath,['-e',"for(const key of ['DATABASE_URL','VITE_SECRET','HTTP_PROXY'])require('node:assert/strict').equal(process.env[key],undefined)"],{...options,stdio:'inherit'});
      if(c.status!==0)process.exitCode=1;
    }`;
  const result = runPhase(directory, 'environment', ['-e', code]);
  assert.equal(assess(directory, { result }).success, true);
});
const workerProbe = ['env sync', 'net IPv4', 'TLS', 'DNS'].map(name =>
  `require('node:assert/strict').throws(()=>{${probes[name]}},{code:'TSP_OFFLINE_DENIED'});`).join('\n');
test('Node child and worker cannot remove env/net/TLS/DNS guards via env or execArgv', () => {
  const directory = createSession();
  const code = `const {spawnSync}=require('node:child_process');
    const c=spawnSync(process.execPath,['-e',${JSON.stringify(workerProbe)}],{env:{},stdio:'inherit'});if(c.status)process.exitCode=1;
    const {Worker}=require('node:worker_threads');const w=new Worker(${JSON.stringify(workerProbe)},{eval:true,env:{},execArgv:['--require','/nonexistent']});
    w.on('error',e=>{throw e});w.on('exit',c=>{if(c)process.exitCode=1});`;
  const result = runPhase(directory, 'inheritance', ['-e', code]);
  const summary = assess(directory, { result });
  assert.equal(result.exit, 0);
  assert.equal(summary.guardCoverage, true);
  assert.equal(summary.unexpectedViolations.length, 8);
  assert.equal(summary.success, false);
});
test('ESM loader worker blocks env/net/TLS/DNS before I/O', () => {
  const directory = createSession();
  const loader = `import {createRequire} from 'node:module';const require=createRequire(${JSON.stringify(import.meta.url)});
    export function initialize(){${workerProbe}}`;
  const code = `require('node:module').register('data:text/javascript,'+encodeURIComponent(${JSON.stringify(loader)}));`;
  const result = runPhase(directory, 'loader-probe', ['-e', code]);
  const summary = assess(directory, { result });
  assert.equal(result.exit, 0, fs.readFileSync(directory + '/loader-probe.log', 'utf8'));
  assert.equal(summary.unexpectedViolations.length, 4);
  assert(summary.unexpectedViolations.every(e => e.thread > 0));
  assert.equal(summary.guardCoverage, true);
  assert.equal(summary.success, false);
});
test('installed tsx parent IPC stays denied in main and loader workers', () => {
  const directory = createSession();
  const result = runPhase(directory, 'tsx-import', ['--input-type=module', '-e', "await import('tsx/esm')"]);
  const summary = assess(directory, { result });
  assert.equal(summary.success, true, JSON.stringify(summary));
  assert.equal(summary.expectedDeniedIpc.length, 2);
  assert(summary.expectedDeniedIpc.some(e => e.thread > 0));
});
test('parent pipe path alone or unrelated stack never classifies as tsx', () => {
  const loaded = { pid: 1, thread: 0, phase: 'build', expectedPipe: '/private-scratch/tsx-501/99.pipe' };
  const event = { ...loaded, kind: 'socket', destination: { path: loaded.expectedPipe },
    stack: `Error\n    at connectToServer (${require.resolve('tsx/package.json').replace('package.json', 'dist/client-D_mPDF5S.mjs')}:1:176)` };
  assert.equal(expectedTsx(event, loaded), true);
  for (const change of [{ stack: 'at unrelated (other.js:1:1)' }, { destination: { path: '/other.pipe' } },
    { pid: 2 }, { thread: 1 }, { phase: 'probe' }, { kind: 'tls' }, { stack: 'at connectToServer (/elsewhere/tsx/dist/client-D_mPDF5S.mjs:1:176)' }]) {
    assert.equal(expectedTsx({ ...event, ...change }, loaded), false);
  }
  const directory = createSession();
  const result = runPhase(directory, 'build', ['-e', `try{require('net').connect(require('path').join(require('os').tmpdir(),'tsx-'+process.geteuid(),process.ppid+'.pipe'))}catch{}`]);
  const summary = assess(directory, { result });
  assert.equal(summary.success, false);
  assert.equal(summary.unexpectedViolations.length, 1);
});
test('guarded Node children need successful completion evidence', () => {
  const directory = createSession();
  const events = [
    { event: 'guard-loaded', pid: 101, thread: 0 },
    { event: 'guard-loaded', pid: 102, thread: 0 },
    { event: 'child', pid: 101, childPid: 102, node: true, evidence: directory },
  ];
  const save = () => fs.writeFileSync(directory + '/events.jsonl', events.map(e => JSON.stringify(e)).join('\n') + '\n');
  const results = { phase: { pid: 101, exit: 0, signal: null, error: null } };
  save();
  assert.equal(assess(directory, results).guardCoverage, true);
  assert.equal(assess(directory, results).success, false);
  assert.equal(assess(directory, results).incompleteNodeChildren.length, 1);
  events.push({ event: 'child-exit', pid: 101, childPid: 102, exit: 7 });
  save();
  assert.equal(assess(directory, results).success, false);
  events.pop();
  events.push({ event: 'child-exit', pid: 101, childPid: 102, exit: 0 });
  save();
  assert.equal(assess(directory, results).success, true);
});
test('nonzero child, missing artifact and absent guard evidence fail summaries', () => {
  const directory = createSession();
  // The outer probe exits zero; the real failing child and its audit stay in
  // this probe's evidence, not in the self-test controller's child results.
  const outer = runPhase(directory, 'failed', ['-e', `const c=require('child_process').spawnSync(process.execPath,['-e','process.exit(7)']);
    console.log(JSON.stringify({pid:c.pid,exit:c.status,signal:c.signal,error:c.error?.code||null}));`]);
  assert.equal(outer.exit, 0);
  const result = JSON.parse(fs.readFileSync(directory + '/failed.log', 'utf8'));
  assert.equal(result.exit, 7);
  assert.equal(assess(directory, { result }).success, false);
  assert.equal(assess(directory, { outer }).success, false);
  const cleanDirectory = createSession();
  const clean = runPhase(cleanDirectory, 'clean', ['-e', '']);
  assert.equal(assess(cleanDirectory, { clean }).success, true);
  assert.equal(assess(cleanDirectory, { clean }, [cleanDirectory + '/missing.cjs']).success, false);
  assert.equal(assess(createSession(), { clean }).success, false);
});