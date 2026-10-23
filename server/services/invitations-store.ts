import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";

/** Private server-only store. See 0049 for the intentional global-table/RLS
 * exception. Never expose a table listing or return rows/recipient reasons.
 * userId MUST come from authentication; ipHash/tokenHash from trusted code.
 * No email sending, URL construction, raw tokens, raw IPs or PII logging here.
 */
export interface ReserveInvitationInput {
  userId: string;
  email: string;
  firstName?: string;
  inviterName: string;
  requestId: string;
  /** Lowercase hex HMAC-SHA256 of a canonical IP, keyed with a server secret. */
  ipHash: string;
  /** Lowercase hex SHA256 of a cryptographically random bearer token. */
  tokenHash: string;
}

export type ReserveInvitationResult =
  | { kind: "reserved"; id: string }
  | { kind: "duplicate"; id: string }
  | { kind: "suppressed" }
  | { kind: "limited" }
  | { kind: "conflict" };

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const address = z.string().trim().toLowerCase().max(254).email();
const inputSchema = z.object({
  userId: z.string().min(1).refine(value => value.trim() === value),
  email: address,
  firstName: z.string().trim().max(100).optional().transform(value => value || null),
  inviterName: z.string().trim().min(1).max(200),
  requestId: uuid,
  ipHash: hash,
  tokenHash: hash,
});
const recipientKey = (email: string) => createHash("sha256").update(email).digest("hex");
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** One global lock across ALL instances/writers, not a sender/recipient lock.
 * Explicit READ COMMITTED ensures queries after waiting see the last commit.
 * Take time AFTER the lock: transaction_timestamp()/now() can predate the wait.
 */
async function locked<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('tsp:friend-invitations:v1', 0))`);
    return run(tx);
  }, { isolationLevel: "read committed" });
}

/** Every real reservation counts, even if queuing/delivery later fails or is
 * suppressed. Suppressed/limited requests create no row; middleware must limit
 * their abuse. Duplicate retries do not extend time or spend another slot.
 * Reuse requires the same normalized payload AND original ipHash/tokenHash;
 * never enqueue a duplicate with a newly generated token or a new dedupe key.
 * Validation/DB errors throw and must fail closed (never send on error).
 */
export async function reserveInvitation(input: ReserveInvitationInput): Promise<ReserveInvitationResult> {
  const data = inputSchema.parse(input);
  const emailHash = recipientKey(data.email);
  return locked(async tx => {
    // Only this inviter's receipt can be returned, even for a shared requestId.
    const existing = (await tx.execute<{
      id: string; email: string; first_name: string | null; inviter_name: string;
      ip_hash: string; token_hash: string;
    }>(sql`select id, email, first_name, inviter_name, ip_hash, token_hash
      from friend_invitations where user_id = ${data.userId} and request_id = ${data.requestId}::uuid
      limit 1`)).rows[0];
    if (existing) {
      const same = existing.email === data.email && existing.first_name === data.firstName
        && existing.inviter_name === data.inviterName && existing.ip_hash === data.ipHash
        && existing.token_hash === data.tokenHash;
      return same ? { kind: "duplicate", id: existing.id } : { kind: "conflict" };
    }

    // Keep one DB timestamp, including sub-millisecond precision, for all
    // windows and the inserted row. Day means UTC, independent of session TZ.
    const { at } = (await tx.execute<{ at: string }>(sql`select clock_timestamp()::text as at`)).rows[0];
    const policy = (await tx.execute<{
      suppressed: boolean; sender_count: number; ip_count: number; total_count: number;
    }>(sql`with bounds as (
        select ${at}::timestamptz as at,
          date_trunc('day', ${at}::timestamptz at time zone 'UTC') at time zone 'UTC' as day_start
      ) select
        (exists (select 1 from friend_invitation_suppressions where email_hash = ${emailHash})
          or exists (select 1 from users where lower(btrim(email)) = ${data.email})
          or exists (select 1 from friend_invitations, bounds
            where email_hash = ${emailHash} and created_at > bounds.at - interval '168 hours')) as suppressed,
        (select count(*)::int from friend_invitations, bounds
          where user_id = ${data.userId} and created_at > bounds.at - interval '24 hours') as sender_count,
        (select count(*)::int from friend_invitations, bounds
          where ip_hash = ${data.ipHash} and created_at >= bounds.day_start) as ip_count,
        (select count(*)::int from friend_invitations, bounds
          where created_at >= bounds.day_start) as total_count`)).rows[0];
    // Check quotas first so an exhausted sender cannot distinguish registered
    // or opted-out addresses (202) from new addresses (429).
    if (policy.sender_count >= 5 || policy.ip_count >= 20 || policy.total_count >= 200) {
      return { kind: "limited" };
    }
    if (policy.suppressed) return { kind: "suppressed" };

    const row = (await tx.execute<{ id: string }>(sql`insert into friend_invitations
      (user_id, request_id, email, email_hash, first_name, inviter_name, ip_hash, token_hash, created_at)
      values (${data.userId}, ${data.requestId}::uuid, ${data.email}, ${emailHash}, ${data.firstName},
        ${data.inviterName}, ${data.ipHash}, ${data.tokenHash}, ${at}::timestamptz)
      on conflict (token_hash) do nothing returning id`)).rows[0];
    return row ? { kind: "reserved", id: row.id } : { kind: "conflict" };
  });
}

/** Internal worker guard, not a public ID lookup and not a delivery claim.
 * Caller validates configured APP_URL, binds the email delivery dedupe identity
 * to this reservation ID, and calls this immediately before provider dispatch.
 * The boolean is a point-in-time check, not a lease against a later opt-out.
 * No fabricated ID/recipient pair may bypass the reservation budgets.
 */
export async function invitationDeliveryAllowed(id: string, recipient: string): Promise<boolean> {
  if (process.env.INVITATIONS_ENABLED === "false") return false;
  const parsedId = uuid.safeParse(id);
  const parsedEmail = address.safeParse(recipient);
  if (!parsedId.success || !parsedEmail.success) return false;
  const result = await db.execute<{ allowed: boolean }>(sql`select exists (
    select 1 from friend_invitations i
    where i.id = ${parsedId.data}::uuid and i.email = ${parsedEmail.data}
      and i.email_hash = ${recipientKey(parsedEmail.data)} and i.status = 'reserved'
      and i.user_id is not null and exists (select 1 from users sender where sender.id = i.user_id)
      and i.created_at <= statement_timestamp()
      and i.created_at >= statement_timestamp() - interval '168 hours'
      and not exists (select 1 from friend_invitation_suppressions s where s.email_hash = i.email_hash)
      and not exists (select 1 from users u where lower(btrim(u.email)) = i.email)
    ) as allowed`);
  return result.rows[0]?.allowed === true && process.env.INVITATIONS_ENABLED !== "false";
}

/** Known token hashes opt out globally and idempotently, including expired
 * delivery links while their invitation row still exists (90-day retention).
 * Unknown/malformed hashes return false. Never returns or selects raw email.
 */
export async function suppressInvitation(tokenHash: string): Promise<boolean> {
  if (!hash.safeParse(tokenHash).success) return false;
  return locked(async tx => {
    const row = (await tx.execute<{ email_hash: string }>(sql`select email_hash
      from friend_invitations where token_hash = ${tokenHash} limit 1`)).rows[0];
    if (!row) return false;
    await tx.execute(sql`insert into friend_invitation_suppressions (email_hash)
      values (${row.email_hash}) on conflict (email_hash) do nothing`);
    return true;
  });
}

/** Internal maintenance. Schedule regularly; no raw email remains in this store
 * after pruning. Suppressions have no expiry and are NEVER deleted here.
 * Unsubscribe links whose invitation has been pruned are no longer known.
 */
export async function pruneInvitations(): Promise<number> {
  return locked(async tx => {
    await tx.execute(sql`delete from email_deliveries
      where type = 'friend_invitation' and created_at < statement_timestamp() - interval '2160 hours'`);
    const result = await tx.execute(sql`delete from friend_invitations
      where created_at < statement_timestamp() - interval '2160 hours'`);
    return result.rowCount ?? 0;
  });
}

/** Safe during rollout before 0049 is applied, and while new sends are disabled. */
export async function pruneInvitationsIfInstalled(): Promise<void> {
  const result = await db.execute<{ installed: boolean }>(sql`select to_regclass('public.friend_invitations') is not null as installed`);
  if (result.rows[0]?.installed) await pruneInvitations();
}