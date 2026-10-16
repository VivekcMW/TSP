// Loaded before tsx/application imports. This is a test tripwire, not an OS sandbox.
const fs = require('node:fs');
const net = require('node:net');
const { fileURLToPath } = require('node:url');
const { syncBuiltinESMExports } = require('node:module');
const Module = require('node:module');
const pg = require('pg');

const scratch = process.env.INVITATIONS_SCRATCH_DB;
if (scratch && !/^tsp_invitation_[a-f0-9]{24}_test$/.test(scratch)) {
  throw new Error('Invalid invitation scratch database name');
}
const allowedDatabase = scratch || 'postgres';
const connect = pg.Client.prototype.connect;
pg.Client.prototype.connect = function (...args) {
  const p = this.connectionParameters;
  if (p.host !== '127.0.0.1' || Number(p.port) !== 5433
      || p.user !== 'vivekanandchoudhari' || p.database !== allowedDatabase || p.ssl) {
    throw new Error('Invitation test denied an unapproved database connection');
  }
  return connect.apply(this, args);
};

const socketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const value = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = typeof value === 'object' ? value : { port: value, host: args[1] };
  if (!options || options.path || options.host !== '127.0.0.1' || Number(options.port) !== 5433) {
    throw new Error('Invitation test denied non-Postgres network access');
  }
  return socketConnect.apply(this, args);
};

function checkFile(value) {
  const name = value instanceof URL ? fileURLToPath(value) : String(value);
  if (/(^|[/\\])\.env(?:[./\\]|$)/i.test(name)) {
    throw new Error('Invitation tests must not read environment files');
  }
}
for (const key of ['readFile', 'readFileSync', 'open', 'openSync', 'createReadStream']) {
  const original = fs[key];
  fs[key] = function (file, ...args) { checkFile(file); return original.call(this, file, ...args); };
}
for (const key of ['readFile', 'open']) {
  const original = fs.promises[key];
  fs.promises[key] = function (file, ...args) { checkFile(file); return original.call(this, file, ...args); };
}
const load = Module._load;
Module._load = function (name, ...args) {
  if (/^(dotenv(?:\/|$)|resend(?:\/|$)|ioredis(?:\/|$))/.test(name)) {
    throw new Error('Invitation tests must not import environment loaders or providers');
  }
  return load.call(this, name, ...args);
};
syncBuiltinESMExports();