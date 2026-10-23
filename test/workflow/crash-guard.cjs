// Loaded before Vitest, and before every owned worker. No env-file loading.
const fs = require('node:fs');
const net = require('node:net');
const dns = require('node:dns');
const cp = require('node:child_process');
const ports = new Set([60053]);
if (process.env.WORKFLOW_CHILD_REDIS_PORT) ports.add(Number(process.env.WORKFLOW_CHILD_REDIS_PORT));
function deny(kind) {
  if (process.env.WORKFLOW_GUARD_LOG) fs.appendFileSync(process.env.WORKFLOW_GUARD_LOG, `${process.pid} ${kind}\n`);
  throw new Error(`Crash acceptance blocked ${kind}`);
}
const spawn = cp.spawn;
cp.spawn = function(command, args, ...rest) {
  const redis = String(command).endsWith('/redis-server');
  if (redis && (!args.includes('--requirepass') || args[args.indexOf('--bind') + 1] !== '127.0.0.1'
    || args[args.indexOf('--save') + 1] !== '' || args[args.indexOf('--appendonly') + 1] !== 'no')) deny('unsafe Redis');
  const child = Reflect.apply(spawn, this, [command, args, ...rest]);
  if (redis) {
    const port = Number(args[args.indexOf('--port') + 1]);
    ports.add(port); child.once('exit', () => ports.delete(port));
  }
  return child;
};
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function(...args) {
  this.once('listening', () => {
    const address = this.address();
    if (address && typeof address === 'object' && address.address === '127.0.0.1') {
      ports.add(address.port); this.once('close', () => ports.delete(address.port));
    }
  });
  return Reflect.apply(listen, this, args);
};
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const o = typeof first === 'object' ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  if (o.path || !['127.0.0.1', 'localhost', '::1'].includes(o.host ?? 'localhost') || !ports.has(Number(o.port))) deny('socket');
  return Reflect.apply(connect, this, args);
};
for (const target of [dns, require('node:dns/promises')]) for (const key of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'reverse']) {
  const original = target[key];
  if (original) target[key] = function(host, ...args) {
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) deny('DNS');
    return Reflect.apply(original, this, [host, ...args]);
  };
}
function fileGuard(file) {
  if (typeof file === 'number') return;
  const name = String(file).split(/[\\/]/).at(-1);
  if (name === '.env' || name.startsWith('.env.') || name.endsWith('.env')) deny('env read');
}
for (const key of ['readFileSync', 'readFile', 'createReadStream', 'openSync', 'open']) {
  const original = fs[key];
  fs[key] = function(file, ...args) { fileGuard(file); return Reflect.apply(original, this, [file, ...args]); };
}
for (const key of ['readFile', 'open']) {
  const original = fs.promises[key];
  fs.promises[key] = function(file, ...args) { fileGuard(file); return Reflect.apply(original, this, [file, ...args]); };
}
require('node:module').syncBuiltinESMExports();