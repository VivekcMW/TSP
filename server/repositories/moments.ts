import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLog, industryMoments, type IndustryMoment } from "@shared/schema";
import type { AdminMoment, MomentFilter, MomentInput, MomentRegion } from "@shared/moments";
import type { MomentRecord } from "../services/moments";

const LIST_LIMIT = 500;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface MomentActor {
  userId: string;
  platformRole: string | null;
  reason: string;
  correlationId?: string;
}

export class MomentNotFoundError extends Error {
  constructor() { super("Moment not found"); }
}

const lastDay = sql`coalesce(${industryMoments.endsOn}, ${industryMoments.startsOn})`;

export function toRecord(row: IndustryMoment): MomentRecord {
  return { id: row.id, title: row.title, startsOn: row.startsOn, endsOn: row.endsOn, region: row.region, tags: row.tags ?? [],
    leadDays: row.leadDays, url: row.url, description: row.description };
}

export function toAdminMoment(row: IndustryMoment): AdminMoment {
  return { ...toRecord(row), region: row.region as MomentRegion, archived: row.archived,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

/** Non-archived moments on any day in [from, to]. Global data: no tenant context is needed to read it. */
export async function findMomentsBetween(from: string, to: string): Promise<MomentRecord[]> {
  const rows = await db.select().from(industryMoments)
    .where(and(eq(industryMoments.archived, false), lte(industryMoments.startsOn, to), sql`${lastDay} >= ${from}::date`))
    .orderBy(asc(industryMoments.startsOn), asc(industryMoments.title), asc(industryMoments.id)).limit(LIST_LIMIT);
  return rows.map(toRecord);
}

export async function listAdminMoments(filter: MomentFilter, today: string): Promise<AdminMoment[]> {
  const where = filter === "archived" ? eq(industryMoments.archived, true)
    : and(eq(industryMoments.archived, false), filter === "upcoming" ? sql`${lastDay} >= ${today}::date` : sql`${lastDay} < ${today}::date`);
  const order = filter === "upcoming" ? [asc(industryMoments.startsOn), asc(industryMoments.title)] : [desc(industryMoments.startsOn), asc(industryMoments.title)];
  const rows = await db.select().from(industryMoments).where(where).orderBy(...order, asc(industryMoments.id)).limit(LIST_LIMIT);
  return rows.map(toAdminMoment);
}

/** Writes are only accepted inside this transaction (RLS checks app.moments_admin, migration 0063). */
async function adminTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.moments_admin', 'on', true)`);
    return work(tx);
  });
}

async function audit(tx: Tx, actor: MomentActor, action: string, row: IndustryMoment) {
  await tx.insert(auditLog).values({
    actorUserId: actor.userId, actorPlatformRole: actor.platformRole, tenantId: null, action,
    resourceType: "industry_moment", resourceId: row.id, justification: actor.reason, correlationId: actor.correlationId ?? null,
    metadata: { title: row.title, startsOn: row.startsOn, endsOn: row.endsOn, region: row.region, tags: row.tags, leadDays: row.leadDays, archived: row.archived },
  });
}

const values = (input: MomentInput) => ({ title: input.title, startsOn: input.startsOn, endsOn: input.endsOn, region: input.region,
  tags: input.tags, leadDays: input.leadDays, url: input.url, description: input.description });

export async function createMoment(input: MomentInput, actor: MomentActor): Promise<AdminMoment> {
  return adminTransaction(async tx => {
    const [row] = await tx.insert(industryMoments).values({ ...values(input), createdBy: actor.userId }).returning();
    await audit(tx, actor, "industry_moment.create", row);
    return toAdminMoment(row);
  });
}

export async function updateMoment(id: string, input: MomentInput, actor: MomentActor): Promise<AdminMoment> {
  return adminTransaction(async tx => {
    const [row] = await tx.update(industryMoments).set({ ...values(input), updatedAt: new Date() })
      .where(eq(industryMoments.id, id)).returning();
    if (!row) throw new MomentNotFoundError();
    await audit(tx, actor, "industry_moment.update", row);
    return toAdminMoment(row);
  });
}

export async function setMomentArchived(id: string, archived: boolean, actor: MomentActor): Promise<AdminMoment> {
  return adminTransaction(async tx => {
    const [row] = await tx.update(industryMoments).set({ archived, updatedAt: new Date() })
      .where(eq(industryMoments.id, id)).returning();
    if (!row) throw new MomentNotFoundError();
    await audit(tx, actor, archived ? "industry_moment.archive" : "industry_moment.unarchive", row);
    return toAdminMoment(row);
  });
}
