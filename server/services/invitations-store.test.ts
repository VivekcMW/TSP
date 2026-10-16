import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), execute: vi.fn() }));
vi.mock("../db", () => ({ db: mocks }));
import {
  invitationDeliveryAllowed, pruneInvitations, reserveInvitation, suppressInvitation,
  type ReserveInvitationInput,
} from "./invitations-store";

// No server/db import, environment credentials, network or shared database.
// These exercise real Drizzle SQL construction and store control flow, NOT
// PostgreSQL execution/concurrency/permissions. Migration remains unapplied.
const dialect = new PgDialect();
const statements: { sql: string; params: unknown[] }[] = [];
const tx = { execute: vi.fn() };
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const at = "2026-09-30 23:59:59.123456+00";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const input: ReserveInvitationInput = {
  userId: "sender-a", email: "friend@example.test", firstName: "Friend", inviterName: "Sender",
  requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ipHash: sha("test-ip"), tokenHash: sha("test-token"),
};
const receipt = () => ({ id, email: input.email, first_name: input.firstName, inviter_name: input.inviterName,
  ip_hash: input.ipHash, token_hash: input.tokenHash });
const available = { suppressed: false, sender_count: 0, ip_count: 0, total_count: 0 };
type Reply = { rows: unknown[]; rowCount?: number };
let replies: Reply[];

function record(query: SQL) {
  const compiled = dialect.sqlToQuery(query);
  const statement = { sql: compiled.sql.replace(/\s+/g, " ").trim(), params: compiled.params };
  statements.push(statement);
  return statement;
}
function setupReservation(policy = available, inserted = true) {
  replies.push({ rows: [] }, { rows: [{ at }] }, { rows: [policy] });
  if (!policy.suppressed && policy.sender_count < 5 && policy.ip_count < 20 && policy.total_count < 200) {
    replies.push({ rows: inserted ? [{ id }] : [] });
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("INVITATIONS_ENABLED", "true");
  replies = [];
  statements.length = 0;
  tx.execute.mockImplementation(async (query: SQL) => {
    const statement = record(query);
    if (statement.sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    const reply = replies.shift();
    if (!reply) throw new Error("Unexpected SQL in mocked store");
    return reply;
  });
  mocks.transaction.mockImplementation(async (run: (value: typeof tx) => Promise<unknown>) => run(tx));
  mocks.execute.mockImplementation(async (query: SQL) => {
    record(query);
    const reply = replies.shift();
    if (!reply) throw new Error("Unexpected SQL outside transaction");
    return reply;
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("invitation reservation", () => {
  it("normalizes recipient/name and writes only the supplied hashes under the global lock", async () => {
    setupReservation();
    await expect(reserveInvitation({ ...input, email: " \tFRIEND@Example.Test\n", firstName: " Friend ", inviterName: " Sender " }))
      .resolves.toEqual({ kind: "reserved", id });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "read committed" });
    expect(statements[0].sql).toContain("pg_advisory_xact_lock(hashtextextended('tsp:friend-invitations:v1', 0))");
    expect(statements[2].sql).toBe("select clock_timestamp()::text as at");
    expect(statements[4].params).toEqual([
      input.userId, input.requestId, input.email, sha(input.email), input.firstName, input.inviterName,
      input.ipHash, input.tokenHash, at,
    ]);
    expect(statements[4].sql).toContain("on conflict (token_hash) do nothing returning id");
    expect(statements.every(statement => !statement.sql.includes(input.email))).toBe(true);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(replies).toHaveLength(0);
  });

  it("waits for lock acquisition before doing any reads", async () => {
    setupReservation();
    let release!: () => void;
    const lock = new Promise<void>(resolve => { release = resolve; });
    tx.execute.mockImplementationOnce(async (query: SQL) => { record(query); await lock; return { rows: [] }; });
    const reservation = reserveInvitation(input);
    await Promise.resolve();
    expect(statements).toHaveLength(1);
    release();
    await expect(reservation).resolves.toEqual({ kind: "reserved", id });
  });

  it("scopes the receipt by inviter AND UUID, returning only an ID before policy evaluation", async () => {
    replies.push({ rows: [receipt()] });
    await expect(reserveInvitation({ ...input, email: " FRIEND@EXAMPLE.TEST " }))
      .resolves.toEqual({ kind: "duplicate", id });
    expect(statements).toHaveLength(2);
    expect(statements[1].sql).toContain("where user_id = $1 and request_id = $2::uuid");
    expect(statements[1].params).toEqual([input.userId, input.requestId]);
  });

  it("does not reveal another inviter's ID when they use the same request UUID and recipient", async () => {
    setupReservation({ ...available, suppressed: true });
    await expect(reserveInvitation({ ...input, userId: "sender-b" })).resolves.toEqual({ kind: "suppressed" });
    expect(statements[1].params).toEqual(["sender-b", input.requestId]);
  });

  it.each([
    { email: "other@example.test" }, { firstName: "Other" }, { inviterName: "Other" },
    { ipHash: sha("other-ip") }, { tokenHash: sha("other-token") },
  ])("rejects mismatched request reuse without writing: %j", async change => {
    replies.push({ rows: [receipt()] });
    await expect(reserveInvitation({ ...input, ...change })).resolves.toEqual({ kind: "conflict" });
    expect(statements).toHaveLength(2);
  });

  it.each([undefined, "", "   "])("treats optional firstName %j as absent", async firstName => {
    replies.push({ rows: [{ ...receipt(), first_name: null }] });
    await expect(reserveInvitation({ ...input, firstName })).resolves.toEqual({ kind: "duplicate", id });
  });

  it.each([
    { sender_count: 5 }, { sender_count: 6 }, { ip_count: 20 }, { ip_count: 21 },
    { total_count: 200 }, { total_count: 201 },
  ])("rejects exhausted budget %j without inserting", async counts => {
    setupReservation({ ...available, ...counts });
    await expect(reserveInvitation(input)).resolves.toEqual({ kind: "limited" });
    expect(statements).toHaveLength(4);
  });

  it("permits the last available slot in all three budgets", async () => {
    setupReservation({ ...available, sender_count: 4, ip_count: 19, total_count: 199 });
    await expect(reserveInvitation(input)).resolves.toEqual({ kind: "reserved", id });
  });

  it("uses global cooldown/opt-out/account predicates and counts every reserved row, not sends", async () => {
    setupReservation({ ...available, suppressed: true, sender_count: 5 });
    await expect(reserveInvitation(input)).resolves.toEqual({ kind: "limited" });
    const policy = statements[3];
    expect(policy.sql).toContain("from friend_invitation_suppressions where email_hash = $3");
    expect(policy.sql).toContain("from users where lower(btrim(email)) = $4");
    expect(policy.sql).toContain("where email_hash = $5 and created_at > bounds.at - interval '168 hours'");
    expect(policy.sql).toContain("where user_id = $6 and created_at > bounds.at - interval '24 hours'");
    expect(policy.sql).toContain("date_trunc('day', $2::timestamptz at time zone 'UTC') at time zone 'UTC'");
    expect(policy.sql).toContain("where ip_hash = $7 and created_at >= bounds.day_start");
    expect(policy.sql).toContain("where created_at >= bounds.day_start) as total_count");
    expect(policy.sql).not.toMatch(/status|email_deliveries/);
    expect(policy.params).toEqual([at, at, sha(input.email), input.email, sha(input.email), input.userId, input.ipHash]);
    expect(statements).toHaveLength(4);
  });

  it("rejects a token hash collision instead of returning somebody else's invitation", async () => {
    setupReservation(available, false);
    await expect(reserveInvitation(input)).resolves.toEqual({ kind: "conflict" });
  });

  it.each([
    { userId: "" }, { email: "not-email" }, { email: "a\nb@example.test" }, { requestId: "not-a-uuid" },
    { ipHash: "127.0.0.1" }, { tokenHash: "raw-token" }, { inviterName: " " }, { firstName: "a".repeat(101) },
  ])("rejects invalid input before accessing storage: %j", async change => {
    await expect(reserveInvitation({ ...input, ...change })).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("propagates a DB failure rather than reserving/sending optimistically", async () => {
    tx.execute.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(reserveInvitation(input)).rejects.toThrow("database unavailable");
    expect(tx.execute).toHaveBeenCalledTimes(1);
  });
});

describe("internal dispatch eligibility", () => {
  it("stops dispatch when the emergency kill switch is false", async () => {
    vi.stubEnv("INVITATIONS_ENABLED", "false");
    await expect(invitationDeliveryAllowed(id, input.email)).resolves.toBe(false);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "true"])("allows dispatch checks by default for flag %j", async flag => {
    vi.stubEnv("INVITATIONS_ENABLED", flag);
    replies.push({ rows: [{ allowed: true }] });
    await expect(invitationDeliveryAllowed(id, input.email)).resolves.toBe(true);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("binds ID, normalized recipient/hash, reserved state, living inviter and seven-day age", async () => {
    replies.push({ rows: [{ allowed: true }] });
    await expect(invitationDeliveryAllowed(id, " FRIEND@EXAMPLE.TEST ")).resolves.toBe(true);
    expect(statements[0].params).toEqual([id, input.email, sha(input.email)]);
    expect(statements[0].sql).toContain("i.id = $1::uuid and i.email = $2 and i.email_hash = $3 and i.status = 'reserved'");
    expect(statements[0].sql).toContain("i.user_id is not null");
    expect(statements[0].sql).toContain("sender.id = i.user_id");
    expect(statements[0].sql).toContain("i.created_at <= statement_timestamp()");
    expect(statements[0].sql).toContain("i.created_at >= statement_timestamp() - interval '168 hours'");
    expect(statements[0].sql).toContain("s.email_hash = i.email_hash");
    expect(statements[0].sql).toContain("lower(btrim(u.email)) = i.email");
    expect(statements[0].sql).not.toContain("email_deliveries");
  });

  it("returns false for missing/mismatched/expired/suppressed records and no result", async () => {
    replies.push({ rows: [{ allowed: false }] }, { rows: [] });
    await expect(invitationDeliveryAllowed(id, "other@example.test")).resolves.toBe(false);
    await expect(invitationDeliveryAllowed(id, input.email)).resolves.toBe(false);
  });

  it("rejects fabricated non-UUID IDs and invalid recipient syntax without querying", async () => {
    await expect(invitationDeliveryAllowed("invitation:made-up", input.email)).resolves.toBe(false);
    await expect(invitationDeliveryAllowed(id, "invalid")).resolves.toBe(false);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("checks the kill switch again after the DB returns", async () => {
    mocks.execute.mockImplementationOnce(async () => {
      vi.stubEnv("INVITATIONS_ENABLED", "false");
      return { rows: [{ allowed: true }] };
    });
    await expect(invitationDeliveryAllowed(id, input.email)).resolves.toBe(false);
  });

  it("propagates DB errors without allowing delivery", async () => {
    mocks.execute.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(invitationDeliveryAllowed(id, input.email)).rejects.toThrow("database unavailable");
  });
});

describe("global unsubscribe and retention", () => {
  it("idempotently suppresses known tokens, independent of enablement and delivery age", async () => {
    vi.stubEnv("INVITATIONS_ENABLED", "false");
    for (let attempt = 0; attempt < 2; attempt++) {
      replies.push({ rows: [{ email_hash: sha(input.email) }] }, { rows: [] });
      await expect(suppressInvitation(input.tokenHash)).resolves.toBe(true);
    }
    expect(statements[0]).toEqual(statements[3]);
    expect(statements[1].sql).toBe("select email_hash from friend_invitations where token_hash = $1 limit 1");
    expect(statements[1].params).toEqual([input.tokenHash]);
    expect(statements[2].sql).toContain("on conflict (email_hash) do nothing");
    expect(statements[2].params).toEqual([sha(input.email)]);
    expect(statements.flatMap(statement => statement.params)).not.toContain(input.email);
  });

  it("does not create suppression for unknown or malformed tokens", async () => {
    await expect(suppressInvitation("raw-token")).resolves.toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
    replies.push({ rows: [] });
    await expect(suppressInvitation(input.tokenHash)).resolves.toBe(false);
    expect(statements).toHaveLength(2);
  });

  it("prunes only invitation rows strictly older than 90 days under the shared lock", async () => {
    replies.push({ rows: [], rowCount: 1 }, { rows: [], rowCount: 3 });
    await expect(pruneInvitations()).resolves.toBe(3);
    expect(statements[0].sql).toContain("pg_advisory_xact_lock");
    expect(statements[1].sql).toBe("delete from email_deliveries where type = 'friend_invitation' and created_at < statement_timestamp() - interval '2160 hours'");
    expect(statements[2].sql).toBe("delete from friend_invitations where created_at < statement_timestamp() - interval '2160 hours'");
    replies.push({ rows: [], rowCount: 0 }, { rows: [], rowCount: 0 });
    await expect(pruneInvitations()).resolves.toBe(0);
  });

  it("declares privacy constraints, indexes, restricted grants and independent suppression lifetime", () => {
    const migration = readFileSync(new URL("../../migrations/0049_friend_invitations.sql", import.meta.url), "utf8");
    expect(migration).toContain("id uuid PRIMARY KEY DEFAULT gen_random_uuid()");
    expect(migration).toContain("REFERENCES users(id) ON DELETE SET NULL");
    expect(migration).toContain("UNIQUE (user_id, request_id)");
    expect(migration).toContain("token_hash varchar(64) NOT NULL UNIQUE");
    expect(migration).toContain("status = 'reserved'");
    expect(migration).toContain("email = lower(btrim(email))");
    for (const index of ["sender_created", "ip_created", "recipient_created", "created"]) {
      expect(migration).toContain(`friend_invitations_${index}_idx`);
    }
    const suppressionDdl = migration.split("CREATE TABLE IF NOT EXISTS friend_invitation_suppressions")[1].split(");")[0];
    expect(suppressionDdl).not.toMatch(/REFERENCES|\bemail\b|user_id/);
    expect(migration).toContain("FROM PUBLIC, tsp_app");
    expect(migration).toContain("GRANT SELECT, INSERT ON friend_invitation_suppressions TO tsp_app");
    expect(migration).not.toMatch(/GRANT[^;]*(?:UPDATE|DELETE)[^;]*ON friend_invitation_suppressions/);
    expect(migration).toContain("Deliberately NOT tenant/app.user_id RLS");
  });
});