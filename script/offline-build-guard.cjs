'use strict';
// Verification hooks, NOT an OS sandbox. Never exempt even recognized tsx IPC.
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { syncBuiltinESMExports } = require('node:module');
const wt = require('node:worker_threads');
const root = path.resolve(__dirname, '..');
const canonical = value => path.resolve(value).replace(/^\/private\/tmp\//, '/tmp/');
const within = (file, directory) => canonical(file) === canonical(directory) || canonical(file).startsWith(canonical(directory) + '/');

function safeEnv(directory, phase = 'verification', production = false) {
  // No inherited PATH, NODE_OPTIONS, credentials, proxies, dotenv or VITE_*.
  return { PATH: '/usr/bin:/bin', HOME: directory, TMPDIR: directory + '/tmp', TZ: 'UTC',
    NODE_ENV: production ? 'production' : 'test', TSX_DISABLE_CACHE: '1',
    TSP_OFFLINE_DIR: directory, TSP_OFFLINE_PHASE: phase,
    NODE_OPTIONS: '--require=' + JSON.stringify(__filename) };
}

function expectedTsx(event, loaded) {
  if (!loaded || !['build', 'design', 'tsx-import'].includes(event.phase)) return false;
  if (event.kind !== 'socket' || event.destination?.path !== loaded.expectedPipe) return false;
  if (event.pid !== loaded.pid || event.thread !== loaded.thread || event.phase !== loaded.phase) return false;
  return ['client-D_mPDF5S.mjs', 'client-D3mGB526.cjs'].some(name => {
    const filename = path.join(path.dirname(require.resolve('tsx/package.json')), 'dist', name);
    return event.stack?.split('\n').some(line => line.trim().startsWith('at connectToServer (') &&
      (line.includes('(' + filename + ':') || line.includes('(file://' + filename + ':')));
  });
}

function destination(args) {
  if (Array.isArray(args[0])) args = args[0];
  const first = args[0];
  if (first && typeof first === 'object') return first.path != null ? { path: String(first.path) } : { host: first.host, port: first.port };
  return typeof first === 'string' && !/^\d+$/.test(first) ? { path: first } : { port: first, host: args[1] };
}
function patchNetwork(deny) {
  const net = require('node:net');
  net.Socket.prototype.connect = function (...args) { return deny('socket', destination(args)); };
  net.Server.prototype.listen = function (...args) { return deny('listen', destination(args)); };
  require('node:tls').connect = function (...args) { return deny('tls', destination(args)); };
  for (const key of ['connect', 'send', 'bind']) require('node:dgram').Socket.prototype[key] = () => deny('udp.' + key);
  function patchDns(target) {
    for (const key of Object.getOwnPropertyNames(target)) {
      if (/^(lookup|lookupService|resolve\w*|query\w*|getHostByAddr|reverse|setServers)$/.test(key) && typeof target[key] === 'function') {
        target[key] = () => deny('dns.' + key);
      }
    }
  }
  for (const module of ['node:dns', 'node:dns/promises']) {
    const dns = require(module);
    patchDns(dns); patchDns(dns.Resolver.prototype);
  }
  for (const [binding, ctor, methods] of [
    ['tcp_wrap', 'TCP', ['connect', 'connect6', 'bind', 'bind6', 'listen']],
    ['pipe_wrap', 'Pipe', ['connect', 'bind', 'listen']],
    ['udp_wrap', 'UDP', ['connect', 'connect6', 'send', 'send6', 'bind', 'bind6']],
  ]) for (const key of methods) {
    const proto = process.binding(binding)[ctor].prototype;
    if (typeof proto[key] === 'function') proto[key] = () => deny('native.' + binding + '.' + key);
  }
  const cares = process.binding('cares_wrap');
  if (cares.ChannelWrap) patchDns(cares.ChannelWrap.prototype);
  for (const key of ['getaddrinfo', 'getnameinfo']) if (cares[key]) cares[key] = () => deny('native.dns.' + key);
}

function isWrite(key, flags) {
  if (!key.startsWith('open')) return /^(write|append|createWrite|mkdir|rm|unlink|truncate|chmod)/.test(key);
  if (typeof flags !== 'number') return /[wa+]/.test(String(flags));
  return !!(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND));
}
function patchFiles(directory, deny) {
  function checkFile(value, write = false) {
    // Descriptor/native/symlink bypasses are outside this non-adversarial JS guard.
    if (typeof value === 'number') return;
    let file = value;
    if (value instanceof URL) file = fileURLToPath(value);
    else if (Buffer.isBuffer(value)) file = value.toString();
    if (typeof file !== 'string') return;
    if (file.split(/[\\/]/).some(part => part === '.env' || part.startsWith('.env.'))) deny('envfile', { path: file });
    if (write && !within(file, directory)) deny('write-outside-scratch', { path: file });
  }
  for (const target of [fs, fs.promises]) {
    for (const key of ['readFileSync', 'readFile', 'createReadStream', 'existsSync', 'accessSync', 'access', 'statSync', 'stat', 'lstatSync', 'lstat',
      'writeFileSync', 'writeFile', 'appendFileSync', 'appendFile', 'createWriteStream', 'mkdirSync', 'mkdir', 'rmSync', 'rm', 'unlinkSync', 'unlink', 'rmdirSync', 'rmdir', 'truncateSync', 'truncate', 'chmodSync', 'chmod', 'openSync', 'open']) {
      if (typeof target[key] !== 'function') continue;
      const original = target[key];
      target[key] = function (file, ...args) {
        checkFile(file, isWrite(key, args[0]));
        return Reflect.apply(original, this, [file, ...args]);
      };
    }
    for (const key of ['rename', 'renameSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync']) {
      const original = target[key];
      if (!original) continue;
      target[key] = function (source, dest, ...args) {
        checkFile(source, key.startsWith('rename')); checkFile(dest, true);
        return Reflect.apply(original, this, [source, dest, ...args]);
      };
    }
  }
  if (process.loadEnvFile) process.loadEnvFile = () => deny('envfile');
}

function patchChildren(directory, phase, event, deny) {
  const cp = require('node:child_process');
  for (const key of ['spawn', 'spawnSync']) {
    const original = cp[key];
    cp[key] = function (command, args = [], options = {}) {
      if (!Array.isArray(args)) { options = args; args = []; }
      const node = command === process.execPath;
      const esbuild = typeof command === 'string' && within(command, root + '/node_modules') && command.endsWith('/bin/esbuild');
      if ((!node && !esbuild) || options.shell) deny('child-executable', { path: String(command) });
      if (node && args.some(arg => /^(?:-r|--inspect|--(?:env-file(?:-if-exists)?|require|import|loader|experimental-(?:loader|config-file|default-config-file))(?:=|$))/.test(arg))) deny('child-loader-option');
      const childDir = options.env?.TSP_OFFLINE_DIR || directory;
      if (!within(childDir, directory)) deny('child-evidence-directory');
      // Only the test controller routes negative controls to separate journals.
      if (childDir !== directory && phase !== 'self-test') deny('child-evidence-directory');
      const childPhase = phase === 'self-test' ? options.env?.TSP_OFFLINE_PHASE || phase : phase;
      const env = safeEnv(childDir, childPhase, options.env?.NODE_ENV === 'production');
      const result = Reflect.apply(original, this, [command, args, { ...options, shell: false, env }]);
      event({ event: 'child', childPid: result.pid, node, evidence: childDir, command,
        ...(key === 'spawnSync' ? { exit: result.status, signal: result.signal, error: result.error?.code || null } : {}) });
      if (key === 'spawn') result.once('exit', (exit, signal) => event({ event: 'child-exit', childPid: result.pid, exit, signal }));
      return result;
    };
  }
  for (const key of ['exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[key] = () => deny('child.' + key);
  const Worker = wt.Worker;
  wt.Worker = class extends Worker {
    constructor(filename, options = {}) {
      super(filename, { ...options, env: safeEnv(directory, phase, process.env.NODE_ENV === 'production'), execArgv: ['--require', __filename] });
      event({ event: 'worker', childThread: this.threadId });
      this.once('exit', exit => event({ event: 'worker-exit', exit }));
    }
  };
}
function install(directory, phase) {
  const append = fs.appendFileSync.bind(fs);
  const log = path.join(directory, 'events.jsonl');
  function event(data) {
    append(log, JSON.stringify({ pid: process.pid, ppid: process.ppid, thread: wt.threadId, phase, ...data }) + '\n', { mode: 0o600 });
  }
  function deny(kind, destination = {}) {
    const error = Object.assign(new Error('Offline verification denied ' + kind), { code: 'TSP_OFFLINE_DENIED' });
    event({ event: 'denied', kind, destination, stack: error.stack });
    throw error;
  }
  patchNetwork(deny);
  patchFiles(directory, deny);
  patchChildren(directory, phase, event, deny);
  syncBuiltinESMExports();
  event({ event: 'guard-loaded', expectedPipe: path.join(require('node:os').tmpdir(), `tsx-${process.geteuid()}`, `${process.ppid}.pipe`) });
}

module.exports = { safeEnv, expectedTsx };
if (process.env.TSP_OFFLINE_DIR) install(process.env.TSP_OFFLINE_DIR, process.env.TSP_OFFLINE_PHASE);