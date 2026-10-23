import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../db";
import { tenants, tenantMembers, users, userProfiles, subscriptions, inboxItems, drafts, draftSchedules, engineRunLogs, userSources, socialAccounts, payments } from "@shared/schema";
import { ADMIN_TENANT_PAGE_SIZE, type TenantDirectory, type TenantDirectoryQuery, type TenantOverview } from "@shared/admin";

export function tenantDirectoryFilter(query: TenantDirectoryQuery) {
  const literal = query.q.replace(/[\\%_]/g, "\\$&");
  return and(
    query.q ? or(ilike(tenants.name, `%${literal}%`), eq(tenants.id, query.q)) : undefined,
    query.status !== "all" ? eq(tenants.status, query.status) : undefined,
    query.kind !== "all" ? eq(tenants.kind, query.kind) : undefined,
  );
}

export async function getTenantDirectory(query: TenantDirectoryQuery): Promise<TenantDirectory> {
  const filter = tenantDirectoryFilter(query);
  const [items, [total]] = await Promise.all([
    db.select({ id: tenants.id, name: tenants.name, kind: tenants.kind, status: tenants.status, createdAt: tenants.createdAt,
      memberCount: count(tenantMembers.userId) })
      .from(tenants).leftJoin(tenantMembers, eq(tenantMembers.tenantId, tenants.id)).where(filter)
      .groupBy(tenants.id).orderBy(desc(tenants.createdAt), tenants.id)
      .limit(ADMIN_TENANT_PAGE_SIZE).offset((query.page - 1) * ADMIN_TENANT_PAGE_SIZE),
    db.select({ value: count() }).from(tenants).where(filter),
  ]);
  if (!total) throw new Error("Tenant directory count unavailable");
  return { items: items.map(item => ({ ...item, createdAt: item.createdAt.toISOString() })), total: total.value,
    page: query.page, pageSize: ADMIN_TENANT_PAGE_SIZE };
}

export async function getTenantOverview(tenantId: string, memberPage = 1): Promise<TenantOverview | null> {
  return db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    await tx.execute(sql`select set_config('statement_timeout', '10000', true)`);
    const [tenant] = await tx.select({ id: tenants.id, name: tenants.name, kind: tenants.kind, status: tenants.status, createdAt: tenants.createdAt })
      .from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) return null;
    const [counts] = (await tx.execute<TenantOverview["counts"]>(sql`select
      (select count(*)::int from ${tenantMembers} where ${tenantMembers.tenantId} = ${tenantId}) as members,
      (select count(*)::int from ${inboxItems} where ${inboxItems.tenantId} = ${tenantId}) as "inboxItems",
      (select count(*)::int from ${drafts} where ${drafts.tenantId} = ${tenantId}) as drafts,
      (select count(*)::int from ${draftSchedules} where ${draftSchedules.tenantId} = ${tenantId}
        and ${draftSchedules.status} = 'failed') as "failedSchedules",
      (select count(*)::int from ${draftSchedules} where ${draftSchedules.tenantId} = ${tenantId}
        and ${draftSchedules.status} in ('scheduled', 'queued')
        and ${draftSchedules.scheduledPublishAt} < ${new Date(Date.now() - 5 * 60_000)}) as "overdueSchedules"`)).rows;
    if (!counts) throw new Error("Tenant summary counts unavailable");
    const members = await tx.select({ userId: tenantMembers.userId, name: users.name, email: users.email, role: tenantMembers.role, onboardingStatus: userProfiles.onboardingStatus })
      .from(tenantMembers).innerJoin(users, eq(users.id, tenantMembers.userId))
      .leftJoin(userProfiles, and(eq(userProfiles.tenantId, tenantMembers.tenantId), eq(userProfiles.userId, tenantMembers.userId)))
      .where(eq(tenantMembers.tenantId, tenantId)).orderBy(tenantMembers.createdAt, tenantMembers.userId).limit(51).offset((memberPage - 1) * 50);
    const [subscription] = await tx.select({ status: subscriptions.status, planId: subscriptions.planId,
      currentPeriodEnd: subscriptions.currentPeriodEnd, cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd })
      .from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).orderBy(desc(subscriptions.createdAt), subscriptions.id).limit(1);
    const runs = await tx.select({ id: engineRunLogs.id, status: engineRunLogs.status, startedAt: engineRunLogs.startedAt,
      articlesProcessed: engineRunLogs.articlesProcessed, articlesMatched: engineRunLogs.articlesMatched })
      .from(engineRunLogs).where(eq(engineRunLogs.tenantId, tenantId)).orderBy(sql`${engineRunLogs.startedAt} desc nulls last`, engineRunLogs.id).limit(10);
    const schedules = await tx.select({ id: draftSchedules.id, status: draftSchedules.status, scheduledPublishAt: draftSchedules.scheduledPublishAt })
      .from(draftSchedules).where(eq(draftSchedules.tenantId, tenantId)).orderBy(sql`${draftSchedules.createdAt} desc nulls last`, draftSchedules.id).limit(10);
    const sources = await tx.select({ id: userSources.id, name: userSources.name, active: userSources.isActive,
      lastFetchedAt: userSources.lastFetchedAt, lastFetchStatus: userSources.lastFetchStatus })
      .from(userSources).where(eq(userSources.tenantId, tenantId)).orderBy(userSources.id).limit(51);
    const connections = await tx.select({ id: socialAccounts.id, provider: socialAccounts.provider, active: socialAccounts.isActive,
      lastSyncAt: socialAccounts.lastSyncAt, tokenExpiresAt: socialAccounts.tokenExpiresAt })
      .from(socialAccounts).where(eq(socialAccounts.tenantId, tenantId)).orderBy(socialAccounts.id).limit(51);
    const recentPayments = await tx.select({ id: payments.id, amount: payments.amount, currency: payments.currency,
      status: payments.status, createdAt: payments.createdAt }).from(payments).where(eq(payments.tenantId, tenantId))
      .orderBy(sql`${payments.createdAt} desc nulls last`, payments.id).limit(10);
    return {
      tenant: { ...tenant, createdAt: tenant.createdAt.toISOString() }, generatedAt: new Date().toISOString(), counts,
      members: members.slice(0, 50), membersTruncated: members.length > 50,
      memberPage,
      sources: sources.slice(0, 50).map(row => ({ ...row, lastFetchedAt: row.lastFetchedAt?.toISOString() ?? null })), sourcesTruncated: sources.length > 50,
      connections: connections.slice(0, 50).map(row => ({ ...row, lastSyncAt: row.lastSyncAt?.toISOString() ?? null, tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null })), connectionsTruncated: connections.length > 50,
      recentPayments: recentPayments.map(row => ({ ...row, createdAt: row.createdAt?.toISOString() ?? null })),
      latestSubscription: subscription ? { ...subscription, currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null } : null,
      recentRuns: runs.map(run => ({ ...run, startedAt: run.startedAt?.toISOString() ?? null })),
      recentSchedules: schedules.map(schedule => ({ ...schedule, scheduledPublishAt: schedule.scheduledPublishAt.toISOString() })),
    };
  });
}
