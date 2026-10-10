import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { ReserveInvitationInput, ReserveInvitationResult } from '../../server/services/invitations-store';

// Standalone, deliberately NOT *.test.ts: default Vitest discovery must not run
// its shared database setup. run.mjs is the only supported entry point.
assert.equal(process.env.INVITATIONS_DB_TESTS, 'true');
const database = process.env.INVITATIONS_SCRATCH_DB!;
assert.match(database, /^tsp_invitation_[a-f0-9]{24}_test$/);
assert.equal(process.env.DATABASE_URL, `postgresql://vivekanandchoudhari:@127.0.0.1:5433/${database}`);
const owner = new pg.Client({ host: '127.0.0.1', port: 5433, user: 'vivekanandchoudhari',
  password: '', database, ssl: false, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
let pool: pg.Pool | undefined;
let store: typeof import('../../server/services/invitations-store');
const tests: { name: string; run: () => Promise<void> }[] = [];
const test = (name: string, run: () => Promise<void>) => tests.push({ name, run });
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const input = (changes: Partial<ReserveInvitationInput> = {}): ReserveInvitationInput => ({
  userId: 'sender-0', email: `${randomUUID()}@example.test`, firstName: 'Friend', inviterName: 'Sender',
  requestId: randomUUID(), ipHash: sha(randomUUID()), tokenHash: sha(randomUUID()), ...changes,
});
async function reserve(data = input()) {
  const result = await store.reserveInvitation(data);
  assert.equal(result.kind, 'reserved');
  assert.ok('id' in result);
  return result.id;
}
async function race(values: ReserveInvitationInput[]) {
  // Drain ALL requests even when one fails, before resetting/closing anything.
  const results = await Promise.allSettled(values.map(value => store.reserveInvitation(value)));
  return results.map(result => { assert.equal(result.status, 'fulfilled'); return result.value; });
}
function outcomes(results: ReserveInvitationResult[], expected: Record<string, number>) {
  const counts: Record<string, number> = {};
  for (const result of results) counts[result.kind] = (counts[result.kind] || 0) + 1;
  assert.deepEqual(counts, expected);
}
async function count(table = 'friend_invitations') {
  assert.ok(['friend_invitations', 'friend_invitation_suppressions', 'email_deliveries'].includes(table));
  return (await owner.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number;
}
async function age(id: string, interval: string) {
  await owner.query('UPDATE friend_invitations SET created_at = clock_timestamp() - $2::interval WHERE id = $1', [id, interval]);
}
async function seed(n: number, changes: Partial<ReserveInvitationInput> = {}, interval = '0 hours') {
  const rows = Array.from({ length: n }, (_, i) => input({ userId: `sender-${i % 60}`, ...changes }));
  await owner.query(`INSERT INTO friend_invitations
    (user_id, request_id, email, email_hash, first_name, inviter_name, ip_hash, token_hash, created_at)
    SELECT r."userId", r."requestId"::uuid, r.email, r."emailHash", r."firstName", r."inviterName",
      r."ipHash", r."tokenHash", clock_timestamp() - $2::interval
    FROM jsonb_to_recordset($1::jsonb) AS r("userId" text, "requestId" text, email text, "emailHash" text,
      "firstName" text, "inviterName" text, "ipHash" text, "tokenHash" text)`,
  [JSON.stringify(rows.map(row => ({ ...row, emailHash: sha(row.email) }))), interval]);
  return rows;
}
async function reset() {
  process.env.INVITATIONS_ENABLED = 'true';
  await owner.query('TRUNCATE friend_invitations, friend_invitation_suppressions, email_deliveries, users');
  await owner.query(`INSERT INTO users (id, email, name)
    SELECT 'sender-' || n, 'sender-' || n || '@example.test', 'Sender ' || n FROM generate_series(0, 69) n`);
}

test('ten distinct runtime connections are restricted tsp_app sessions', async () => {
  const clients = await Promise.all(Array.from({ length: 10 }, () => pool!.connect()));
  try {
    const rows = await Promise.all(clients.map(async client => (await client.query(`SELECT current_database() AS db,
      current_user AS role, current_setting('TimeZone') AS timezone, pg_backend_pid() AS pid,
      host(inet_server_addr()) AS host, inet_server_port() AS port,
      rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)).rows[0]));
    assert.equal(new Set(rows.map(row => row.pid)).size, 10);
    for (const row of rows) {
      assert.deepEqual({ ...row, pid: 0 }, { db: database, role: 'tsp_app', pid: 0,
        timezone: 'Pacific/Honolulu', host: '127.0.0.1', port: 5433, rolsuper: false, rolbypassrls: false });
    }
  } finally { clients.forEach(client => client.release()); }
});

test('0049 creates only expected tables, indexes, and no public table privileges', async () => {
  const tables = await owner.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  assert.deepEqual(tables.rows.map(row => row.tablename), ['email_deliveries', 'friend_invitation_suppressions', 'friend_invitations', 'users']);
  const indexes = await owner.query("SELECT indexname FROM pg_indexes WHERE tablename = 'friend_invitations'");
  for (const name of ['sender_created', 'ip_created', 'recipient_created', 'created']) {
    assert.ok(indexes.rows.some(row => row.indexname === `friend_invitations_${name}_idx`));
  }
  const publicGrants = await owner.query(`SELECT a.privilege_type FROM pg_class c,
    LATERAL aclexplode(c.relacl) a WHERE c.relname IN ('friend_invitations', 'friend_invitation_suppressions') AND a.grantee = 0`);
  assert.equal(publicGrants.rowCount, 0);
  const rls = await owner.query("SELECT relrowsecurity FROM pg_class WHERE relname IN ('friend_invitations', 'friend_invitation_suppressions')");
  assert.deepEqual(rls.rows, [{ relrowsecurity: false }, { relrowsecurity: false }]);
});

test('actual SET ROLE grants allow store operations but reject UPDATE/TRUNCATE/suppression DELETE', async () => {
  const data = input();
  await reserve(data);
  assert.equal(await store.suppressInvitation(data.tokenHash), true);
  for (const sql of ['UPDATE friend_invitations SET inviter_name = inviter_name',
    'TRUNCATE friend_invitations', 'DELETE FROM friend_invitation_suppressions',
    'UPDATE friend_invitation_suppressions SET created_at = created_at', 'TRUNCATE friend_invitation_suppressions']) {
    await assert.rejects(pool!.query(sql), { code: '42501' });
  }
  assert.equal((await pool!.query('DELETE FROM friend_invitations')).rowCount, 1);
  assert.equal(await count('friend_invitation_suppressions'), 1);
});

test('ten concurrent sender requests reserve exactly five', async () => {
  outcomes(await race(Array.from({ length: 10 }, () => input())), { reserved: 5, limited: 5 });
  assert.equal(await count(), 5);
});

test('sender budget is rolling 24 hours, not the UTC calendar day', async () => {
  await seed(5, { userId: 'sender-0' }, '23 hours');
  assert.deepEqual(await store.reserveInvitation(input()), { kind: 'limited' });
  await owner.query("UPDATE friend_invitations SET created_at = clock_timestamp() - interval '25 hours'");
  await reserve();
});

test('different users concurrently share one normalized recipient cooldown for seven days', async () => {
  const email = 'shared@example.test';
  const values = Array.from({ length: 10 }, (_, i) => input({ userId: `sender-${i}`, email: i % 2 ? email : ' SHARED@EXAMPLE.TEST ' }));
  const results = await race(values);
  outcomes(results, { reserved: 1, suppressed: 9 });
  assert.equal(await count(), 1);
  const winner = results.find(result => result.kind === 'reserved')!;
  assert.ok('id' in winner);
  await age(winner.id, '167 hours');
  assert.deepEqual(await store.reserveInvitation(input({ userId: 'sender-20', email })), { kind: 'suppressed' });
  await age(winner.id, '169 hours');
  await reserve(input({ userId: 'sender-20', email }));
});

test('ten duplicate request keys create one receipt without extending its timestamp', async () => {
  const data = input();
  const results = await race(Array.from({ length: 10 }, () => data));
  outcomes(results, { reserved: 1, duplicate: 9 });
  assert.equal(new Set(results.map(result => 'id' in result ? result.id : '')).size, 1);
  const before = (await owner.query('SELECT created_at::text FROM friend_invitations')).rows;
  await store.reserveInvitation({ ...data, email: ` ${data.email.toUpperCase()} `, firstName: ' Friend ' });
  assert.deepEqual((await owner.query('SELECT created_at::text FROM friend_invitations')).rows, before);
  assert.equal(await count(), 1);
});

for (const field of ['email', 'firstName', 'inviterName', 'ipHash', 'tokenHash'] as const) {
  test(`same request with changed ${field} conflicts without writing`, async () => {
    const data = input();
    await reserve(data);
    const changedValues = { email: 'other@example.test', firstName: 'Changed', inviterName: 'Changed',
      ipHash: sha('changed'), tokenHash: sha('changed') };
    const changed = changedValues[field];
    assert.deepEqual(await store.reserveInvitation({ ...data, [field]: changed }), { kind: 'conflict' });
    assert.equal(await count(), 1);
  });
}

test('request keys are sender-scoped and never expose another sender receipt', async () => {
  const data = input();
  const first = await reserve(data);
  assert.deepEqual(await store.reserveInvitation({ ...data, userId: 'sender-1' }), { kind: 'suppressed' });
  const second = await reserve(input({ userId: 'sender-1', requestId: data.requestId }));
  assert.notEqual(first, second);
});

test('concurrent globally duplicate token hashes conflict rather than returning another receipt', async () => {
  const tokenHash = sha('same-token');
  outcomes(await race([input({ tokenHash }), input({ tokenHash, userId: 'sender-1' })]), { reserved: 1, conflict: 1 });
  assert.equal(await count(), 1);
});

test('SQL unique constraints reject duplicate sender request and token independently of store', async () => {
  const data = input();
  await reserve(data);
  await assert.rejects(seed(1, { userId: data.userId, requestId: data.requestId }), { code: '23505' });
  await assert.rejects(seed(1, { tokenHash: data.tokenHash }), { code: '23505' });
  assert.equal(await count(), 1);
});

test('SQL constraints reject raw hashes, unnormalized email, unsupported state, and missing sender', async () => {
  await assert.rejects(seed(1, { tokenHash: 'raw-token' }), { code: '23514' });
  await assert.rejects(seed(1, { ipHash: '127.0.0.1' }), { code: '23514' });
  await assert.rejects(seed(1, { email: 'NOT-NORMALIZED@example.test' }), { code: '23514' });
  await assert.rejects(seed(1, { userId: 'missing' }), { code: '23503' });
  const id = await reserve();
  await assert.rejects(owner.query("UPDATE friend_invitations SET status = 'sent' WHERE id = $1", [id]), { code: '23514' });
});

test('existing accounts and self-invitations are suppressed without reserving', async () => {
  await owner.query("UPDATE users SET email = ' Existing@Example.Test ' WHERE id = 'sender-1'");
  for (const email of ['existing@example.test', ' SENDER-0@EXAMPLE.TEST ']) {
    assert.deepEqual(await store.reserveInvitation(input({ email })), { kind: 'suppressed' });
  }
  assert.equal(await count(), 0);
});

test('opt-out accepts only known hashes, is concurrent/idempotent and stores no raw email', async () => {
  const data = input();
  const id = await reserve(data);
  for (const token of ['raw-token', data.tokenHash.toUpperCase(), sha('unknown')]) {
    assert.equal(await store.suppressInvitation(token), false);
  }
  assert.equal(await count('friend_invitation_suppressions'), 0);
  assert.deepEqual(await Promise.all(Array.from({ length: 10 }, () => store.suppressInvitation(data.tokenHash))), new Array(10).fill(true));
  assert.equal(await count('friend_invitation_suppressions'), 1);
  const row = (await owner.query('SELECT * FROM friend_invitation_suppressions')).rows[0];
  assert.deepEqual(Object.keys(row).sort((a, b) => a.localeCompare(b)), ['created_at', 'email_hash']);
  assert.equal(row.email_hash, sha(data.email));
  assert.equal(await store.invitationDeliveryAllowed(id, data.email), false);
  await age(id, '8 days');
  assert.deepEqual(await store.reserveInvitation(input({ email: data.email, userId: 'sender-1' })), { kind: 'suppressed' });
});

test('dispatch defaults on, honors the false kill switch and requires an actual recipient-bound reservation', async () => {
  const data = input();
  const id = await reserve(data);
  for (const flag of [undefined, '', 'true']) {
    if (flag === undefined) delete process.env.INVITATIONS_ENABLED;
    else process.env.INVITATIONS_ENABLED = flag;
    assert.equal(await store.invitationDeliveryAllowed(id, data.email), true);
  }
  process.env.INVITATIONS_ENABLED = 'false';
  assert.equal(await store.invitationDeliveryAllowed(id, data.email), false);
  delete process.env.INVITATIONS_ENABLED;
  assert.equal(await store.invitationDeliveryAllowed(id, ` ${data.email.toUpperCase()} `), true);
  assert.equal(await store.invitationDeliveryAllowed(id, 'mismatch@example.test'), false);
  assert.equal(await store.invitationDeliveryAllowed(randomUUID(), data.email), false);
  assert.equal(await store.invitationDeliveryAllowed('invalid', data.email), false);
  assert.equal(await store.invitationDeliveryAllowed(id, 'invalid'), false);
});

test('dispatch expires after seven days and rejects future timestamps; old links still opt out', async () => {
  const data = input();
  const id = await reserve(data);
  await age(id, '167 hours');
  assert.equal(await store.invitationDeliveryAllowed(id, data.email), true);
  await age(id, '169 hours');
  assert.equal(await store.invitationDeliveryAllowed(id, data.email), false);
  process.env.INVITATIONS_ENABLED = 'false';
  assert.equal(await store.suppressInvitation(data.tokenHash), true);
  process.env.INVITATIONS_ENABLED = 'true';
  const future = input();
  const futureId = await reserve(future);
  await age(futureId, '-1 hour');
  assert.equal(await store.invitationDeliveryAllowed(futureId, future.email), false);
});

test('account creation after reservation immediately prevents dispatch', async () => {
  const data = input();
  const id = await reserve(data);
  assert.equal(await store.invitationDeliveryAllowed(id, data.email), true);
  await owner.query('INSERT INTO users (id, email) VALUES ($1, $2)', ['new-account', ` ${data.email.toUpperCase()} `]);
  assert.equal(await store.invitationDeliveryAllowed(id, data.email), false);
});

test('user deletion SET NULL prevents dispatch but preserves global cooldown and IP accounting', async () => {
  const data = input();
  const id = await reserve(data);
  await seed(19, { ipHash: data.ipHash });
  await owner.query("DELETE FROM users WHERE id = 'sender-0'");
  assert.equal((await owner.query('SELECT user_id FROM friend_invitations WHERE id = $1', [id])).rows[0].user_id, null);
  assert.equal(await count(), 20);
  assert.equal(await store.invitationDeliveryAllowed(id, data.email), false);
  assert.deepEqual(await store.reserveInvitation(input({ userId: 'sender-60', email: data.email })), { kind: 'suppressed' });
  assert.deepEqual(await store.reserveInvitation(input({ userId: 'sender-60', ipHash: data.ipHash })), { kind: 'limited' });
  assert.equal(await store.suppressInvitation(data.tokenHash), true);
});

test('concurrent different senders cannot exceed twenty UTC-day reservations per IP', async () => {
  const ipHash = sha('shared-ip');
  await seed(19, { ipHash });
  outcomes(await race(Array.from({ length: 10 }, (_, i) => input({ userId: `sender-${i + 30}`, ipHash }))), { reserved: 1, limited: 9 });
  assert.equal(await count(), 20);
  await reserve(input({ userId: 'sender-60' }));
});

test('concurrent different senders and IPs cannot exceed two hundred UTC-day reservations', async () => {
  await seed(199);
  outcomes(await race(Array.from({ length: 10 }, (_, i) => input({ userId: `sender-${i + 60}` }))), { reserved: 1, limited: 9 });
  assert.equal(await count(), 200);
});

test('IP/global caps reset at UTC midnight independent of runtime session timezone', async () => {
  const ipHash = sha('shared-ip');
  await seed(200, { ipHash });
  await owner.query(`UPDATE friend_invitations SET created_at =
    (date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - interval '1 second'`);
  // A sender with no prior rows avoids conflating the rolling sender quota.
  await reserve(input({ userId: 'sender-60', ipHash }));
  assert.equal(await count(), 201);
});

test('prune removes >90-day reservations, retains younger rows and permanent suppressions', async () => {
  const old = input();
  const oldId = await reserve(old);
  assert.equal(await store.suppressInvitation(old.tokenHash), true);
  await age(oldId, '2161 hours');
  const keep = input();
  const keepId = await reserve(keep);
  await age(keepId, '2159 hours');
  await reserve();
  assert.equal(await store.pruneInvitations(), 1);
  assert.equal(await count(), 2);
  assert.equal(await count('friend_invitation_suppressions'), 1);
  assert.equal(await store.suppressInvitation(old.tokenHash), false);
  assert.equal(await store.suppressInvitation(keep.tokenHash), true);
  assert.deepEqual(await store.reserveInvitation(input({ email: old.email, userId: 'sender-1' })), { kind: 'suppressed' });
  assert.equal(await store.pruneInvitations(), 0);
});

test('prune removes only old friend_invitation email deliveries, not other types or younger rows', async () => {
  await owner.query(`INSERT INTO email_deliveries (id, type, created_at) VALUES
    ('old-invite', 'friend_invitation', clock_timestamp() - interval '2161 hours'),
    ('keep-invite', 'friend_invitation', clock_timestamp() - interval '2159 hours'),
    ('keep-other', 'welcome', clock_timestamp() - interval '2161 hours')`);
  await store.pruneInvitations();
  assert.deepEqual((await owner.query('SELECT id FROM email_deliveries ORDER BY id')).rows.map(row => row.id), ['keep-invite', 'keep-other']);
});

let passed = 0;
let failed = 0;
let setupFailed = false;
try {
  await owner.connect();
  assert.equal((await owner.query('SELECT current_database() AS name')).rows[0].name, database);
  // Fixture tables ONLY; no historical migrations and no changes to cluster roles.
  await owner.query(`CREATE TABLE users (id varchar PRIMARY KEY, email varchar, name varchar, first_name varchar);
    CREATE TABLE email_deliveries (id varchar PRIMARY KEY, type varchar NOT NULL, created_at timestamptz NOT NULL);
    GRANT USAGE ON SCHEMA public TO tsp_app;
    GRANT SELECT ON users TO tsp_app;
    GRANT SELECT, DELETE ON email_deliveries TO tsp_app;`);
  await owner.query(readFileSync(new URL('../../migrations/0049_friend_invitations.sql', import.meta.url), 'utf8'));
  // Import the real pool first so cleanup still works if store import fails.
  ({ pool } = await import('../../server/db'));
  pool.options.password = '';
  pool.options.ssl = false;
  // Startup role also fails closed if SET ROLE ever fails: the connection must
  // never have owner privileges while executing application SQL.
  pool.options.options = '-c role=tsp_app -c timezone=Pacific/Honolulu';
  pool.on('connect', client => {
    // Queue SET ROLE before pg-pool hands the client to any store query. A failed
    // SET ROLE destroys that socket; it must never fall back to owner execution.
    void client.query('SET ROLE tsp_app').catch(error => { void client.end(); console.error(error); });
  });
  store = await import('../../server/services/invitations-store');
  for (const { name, run } of tests) {
    try {
      await reset();
      await run();
      passed++;
      console.log(`PASS ${name}`);
    } catch (error) {
      failed++;
      console.error(`FAIL ${name}`, error);
    }
  }
} catch (error) {
  setupFailed = true;
  console.error('SETUP FAILED', error);
} finally {
  try { await pool?.end(); } finally { await owner.end(); }
  console.log(JSON.stringify({ suite: 'isolated-invitations-postgres', tests: tests.length, passed, failed,
    skipped: tests.length - passed - failed, setupFailed, database, poolClosed: true }));
  process.exitCode = setupFailed || failed || passed !== tests.length ? 1 : 0;
}