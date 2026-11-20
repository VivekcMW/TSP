import { and, count, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "../db";
import { withTenantTransaction, type TenantScope, type TenantTx } from "../storage";
import {
  captureTokens, inboundAddresses, inboundMessages,
  type CaptureToken, type InboundAddress, type InboundMessage,
} from "@shared/schema";

export const CAPTURE_TOKEN_LIMIT = 5;
export const INBOUND_DAILY_MESSAGE_LIMIT = 30;
export const RECENT_INBOUND_LIMIT = 10;
const TOKEN_HASH = /^[0-9a-f]{64}$/;

export class CaptureTokenLimitError extends Error {
  readonly status = 409;
  constructor() { super(`You can have up to ${CAPTURE_TOKEN_LIMIT} active keys. Revoke one first.`); }
}

/** Who a bearer token belongs to. Callers must still confirm the membership is current. */
export interface TokenOwner { id: string; tenantId: string; userId: string }
export interface StoredSecret { hash: string; hint: string; encrypted?: string | null }
export type InboundReservation = { outcome: "reserved"; id: string } | { outcome: "duplicate" } | { outcome: "rate_limited" };

/** Only the identifiers: a request's TenantContext carries role fields that must never reach an insert. */
function member(scope: TenantScope): TenantScope {
  return { tenantId: scope.tenantId, userId: scope.userId };
}

function owned(table: { tenantId: AnyPgColumn; userId: AnyPgColumn }, scope: TenantScope) {
  return and(eq(table.tenantId, scope.tenantId), eq(table.userId, scope.userId));
}

async function lockMember(tx: TenantTx, name: string, scope: TenantScope) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([name, scope.tenantId, scope.userId])}, 0))`);
}

/**
 * Token lookups run before any tenant is known. Migration 0064 lets this one
 * transaction read only the row whose token_hash equals the setting below.
 */
async function lookupByHash<T>(setting: "app.inbound_token_hash" | "app.capture_token_hash", tokenHash: string,
  query: (tx: TenantTx) => Promise<T>): Promise<T | undefined> {
  if (!TOKEN_HASH.test(tokenHash)) return undefined;
  return db.transaction(async tx => {
    await tx.execute(sql`select set_config(${setting}, ${tokenHash}, true)`);
    return query(tx);
  });
}

// ------------------------------------------------------------ forwarding address

export function getInboundAddress(scope: TenantScope): Promise<InboundAddress | undefined> {
  return withTenantTransaction(scope, async tx => {
    const [row] = await tx.select().from(inboundAddresses).where(owned(inboundAddresses, scope)).limit(1);
    return row;
  });
}

/** Creates the member's address, or returns the existing one untouched. */
export function createInboundAddress(scope: TenantScope, secret: StoredSecret): Promise<{ address: InboundAddress; created: boolean }> {
  return withTenantTransaction(scope, async tx => {
    const [created] = await tx.insert(inboundAddresses)
      .values({ ...member(scope), tokenHash: secret.hash, tokenHint: secret.hint, tokenEncrypted: secret.encrypted ?? null })
      .onConflictDoNothing({ target: [inboundAddresses.tenantId, inboundAddresses.userId] }).returning();
    if (created) return { address: created, created: true };
    const [existing] = await tx.select().from(inboundAddresses).where(owned(inboundAddresses, scope)).limit(1);
    return { address: existing, created: false };
  });
}

/** New token for the existing address (the old one stops working at once); also re-enables it. */
export function replaceInboundAddressToken(scope: TenantScope, secret: StoredSecret): Promise<InboundAddress | undefined> {
  return withTenantTransaction(scope, async tx => {
    const [row] = await tx.update(inboundAddresses)
      .set({ tokenHash: secret.hash, tokenHint: secret.hint, tokenEncrypted: secret.encrypted ?? null, rotatedAt: sql`now()`, disabled: false })
      .where(owned(inboundAddresses, scope)).returning();
    return row;
  });
}

export function disableInboundAddress(scope: TenantScope): Promise<boolean> {
  return withTenantTransaction(scope, async tx => {
    const rows = await tx.update(inboundAddresses).set({ disabled: true })
      .where(owned(inboundAddresses, scope)).returning({ id: inboundAddresses.id });
    return rows.length > 0;
  });
}

export function resolveInboundAddress(tokenHash: string): Promise<TokenOwner | undefined> {
  return lookupByHash("app.inbound_token_hash", tokenHash, async tx => {
    const [row] = await tx.select({ id: inboundAddresses.id, tenantId: inboundAddresses.tenantId, userId: inboundAddresses.userId })
      .from(inboundAddresses).where(and(eq(inboundAddresses.tokenHash, tokenHash), eq(inboundAddresses.disabled, false))).limit(1);
    return row;
  });
}

// ------------------------------------------------------------ received newsletters

/** Dedupes by Message-ID and enforces the daily per-address limit before anything is created. */
export function reserveInboundMessage(scope: TenantScope, message: {
  messageId: string; fromAddress: string | null; fromName: string | null; subject: string | null;
}): Promise<InboundReservation> {
  return withTenantTransaction(scope, async tx => {
    await lockMember(tx, "inbound_messages", scope);
    const [duplicate] = await tx.select({ id: inboundMessages.id }).from(inboundMessages)
      .where(and(owned(inboundMessages, scope), eq(inboundMessages.messageId, message.messageId))).limit(1);
    if (duplicate) return { outcome: "duplicate" } as const;
    const [recent] = await tx.select({ total: count() }).from(inboundMessages)
      .where(and(owned(inboundMessages, scope), gte(inboundMessages.receivedAt, sql`now() - interval '1 day'`)));
    if (Number(recent.total) >= INBOUND_DAILY_MESSAGE_LIMIT) return { outcome: "rate_limited" } as const;
    const [row] = await tx.insert(inboundMessages).values({ ...member(scope), ...message, status: "processing" }).returning({ id: inboundMessages.id });
    return { outcome: "reserved", id: row.id } as const;
  });
}

export function finishInboundMessage(scope: TenantScope, id: string, result: {
  status: "processed" | "confirmation"; linksFound: number; itemsCreated: number;
}): Promise<void> {
  return withTenantTransaction(scope, async tx => {
    await tx.update(inboundMessages).set(result).where(and(owned(inboundMessages, scope), eq(inboundMessages.id, id)));
  });
}

/** Frees a reservation whose processing failed, so the provider's retry is not treated as a duplicate. */
export function releaseInboundMessage(scope: TenantScope, id: string): Promise<void> {
  return withTenantTransaction(scope, async tx => {
    await tx.delete(inboundMessages)
      .where(and(owned(inboundMessages, scope), eq(inboundMessages.id, id), eq(inboundMessages.status, "processing")));
  });
}

export function listInboundMessages(scope: TenantScope, limit = RECENT_INBOUND_LIMIT): Promise<InboundMessage[]> {
  return withTenantTransaction(scope, tx => tx.select().from(inboundMessages).where(owned(inboundMessages, scope))
    .orderBy(desc(inboundMessages.receivedAt), desc(inboundMessages.id)).limit(limit));
}

// ------------------------------------------------------------ capture tokens

export function listCaptureTokens(scope: TenantScope): Promise<CaptureToken[]> {
  return withTenantTransaction(scope, tx => tx.select().from(captureTokens)
    .where(and(owned(captureTokens, scope), isNull(captureTokens.revokedAt)))
    .orderBy(desc(captureTokens.createdAt), desc(captureTokens.id)).limit(CAPTURE_TOKEN_LIMIT));
}

export function createCaptureToken(scope: TenantScope, secret: StoredSecret, label: string): Promise<CaptureToken> {
  return withTenantTransaction(scope, async tx => {
    // Serialize this member's creates so concurrent requests cannot pass the limit together.
    await lockMember(tx, "capture_tokens", scope);
    const [active] = await tx.select({ total: count() }).from(captureTokens)
      .where(and(owned(captureTokens, scope), isNull(captureTokens.revokedAt)));
    if (Number(active.total) >= CAPTURE_TOKEN_LIMIT) throw new CaptureTokenLimitError();
    const [row] = await tx.insert(captureTokens).values({ ...member(scope), tokenHash: secret.hash, tokenHint: secret.hint, label }).returning();
    return row;
  });
}

export function revokeCaptureToken(scope: TenantScope, id: string): Promise<boolean> {
  return withTenantTransaction(scope, async tx => {
    const rows = await tx.update(captureTokens).set({ revokedAt: sql`now()` })
      .where(and(owned(captureTokens, scope), eq(captureTokens.id, id), isNull(captureTokens.revokedAt)))
      .returning({ id: captureTokens.id });
    return rows.length > 0;
  });
}

export function resolveCaptureToken(tokenHash: string): Promise<TokenOwner | undefined> {
  return lookupByHash("app.capture_token_hash", tokenHash, async tx => {
    const [row] = await tx.select({ id: captureTokens.id, tenantId: captureTokens.tenantId, userId: captureTokens.userId })
      .from(captureTokens).where(and(eq(captureTokens.tokenHash, tokenHash), isNull(captureTokens.revokedAt))).limit(1);
    return row;
  });
}

export function touchCaptureToken(scope: TenantScope, id: string): Promise<void> {
  return withTenantTransaction(scope, async tx => {
    await tx.update(captureTokens).set({ lastUsedAt: sql`now()` })
      .where(and(owned(captureTokens, scope), eq(captureTokens.id, id), isNull(captureTokens.revokedAt)));
  });
}
