import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// No Vite/Vitest config, setupFiles, dotenv, inherited NODE_OPTIONS or PG*.
// Use the documented env -i invocation to prevent preloads before this executes.
if (process.env.INVITATIONS_DB_TESTS !== 'true') {
  console.log('SKIP: opt in with INVITATIONS_DB_TESTS=true; no database connection made.');
} else {
  const keep = new Set(['PATH', 'HOME', 'TMPDIR', 'INVITATIONS_DB_TESTS']);
  for (const key of Object.keys(process.env)) if (!keep.has(key)) delete process.env[key];
  await import('./guard.cjs');
  const { default: pg } = await import('pg');
  const database = `tsp_invitation_${randomBytes(12).toString('hex')}_test`;
  assert.match(database, /^tsp_invitation_[a-f0-9]{24}_test$/);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const sources = ['server/services/invitations-store.ts', 'migrations/0049_friend_invitations.sql'];
  const digest = file => createHash('sha256').update(readFileSync(new URL(`../../${file}`, import.meta.url))).digest('hex');
  const before = Object.fromEntries(sources.map(file => [file, digest(file)]));
  const admin = new pg.Client({ host: '127.0.0.1', port: 5433, user: 'vivekanandchoudhari',
    password: '', database: 'postgres', ssl: false, connectionTimeoutMillis: 5000 });
  let created = false;
  let child;
  let interrupted = false;
  const interrupt = () => { interrupted = true; child?.kill('SIGTERM'); };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    await admin.connect();
    // No shared-table queries, role changes, or migration runner. template0 is empty.
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    created = true;
    console.log(JSON.stringify({ database, host: '127.0.0.1', port: 5433, before }));
    if (interrupted) throw new Error('Interrupted before starting tests');
    const exit = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, ['--require', fileURLToPath(new URL('./guard.cjs', import.meta.url)),
        '--import', 'tsx', fileURLToPath(new URL('./postgres.ts', import.meta.url))], {
        cwd: root, stdio: 'inherit', env: {
          PATH: process.env.PATH || '', HOME: process.env.HOME || '',
          ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
          NODE_ENV: 'test', INVITATIONS_DB_TESTS: 'true', INVITATIONS_SCRATCH_DB: database,
          DATABASE_URL: `postgresql://vivekanandchoudhari:@127.0.0.1:5433/${database}`,
          DB_POOL_MAX: '10', DB_CONNECTION_TIMEOUT_MS: '5000', DB_STATEMENT_TIMEOUT_MS: '10000',
          DB_IDLE_TRANSACTION_TIMEOUT_MS: '10000', TSX_DISABLE_CACHE: '1',
        },
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    console.log(JSON.stringify({ childExit: exit }));
    const after = Object.fromEntries(sources.map(file => [file, digest(file)]));
    console.log(JSON.stringify({ after, sourcesUnchanged: sources.every(file => before[file] === after[file]) }));
    assert.deepEqual(after, before, 'Store/migration changed during verification; rerun latest files');
    assert.equal(exit.code, 0, 'Postgres invitation tests failed');
    assert.equal(interrupted, false, 'Test interrupted');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    try {
      if (created) {
        // FORCE is confined to the exact database this process successfully created.
        await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
        const remains = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
        assert.equal(remains.rowCount, 0);
        console.log(JSON.stringify({ cleanup: 'verified', database, remainingDatabases: 0 }));
      }
    } catch (error) {
      console.error('Scratch database cleanup failed:', database, error);
      process.exitCode = 1;
    } finally {
      await admin.end();
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    }
  }
}