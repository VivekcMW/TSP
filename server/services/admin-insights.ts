import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { aiAttemptObservations, billingGenerationOperations, payments, userSources, inboxItems, draftFeedbackEvents } from "@shared/schema";
import type { AdminTenantInsights } from "@shared/admin-controls";

export function getTenantInsights(tenantId: string): Promise<AdminTenantInsights> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 30 * 86_400_000);
  return db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    await tx.execute(sql`select set_config('statement_timeout', '10000', true)`);
    const generation = await tx.select({ status: billingGenerationOperations.status, count: sql<number>`count(*)::int` })
      .from(billingGenerationOperations).where(and(eq(billingGenerationOperations.tenantId, tenantId), gte(billingGenerationOperations.createdAt, windowStart)))
      .groupBy(billingGenerationOperations.status).orderBy(billingGenerationOperations.status);
    const paymentTotals = await tx.select({ status: payments.status, currency: payments.currency, count: sql<number>`count(*)::int`, minorUnits: sql<string>`sum(${payments.amount})::text` })
      .from(payments).where(and(eq(payments.tenantId, tenantId), gte(payments.createdAt, windowStart))).groupBy(payments.status, payments.currency).orderBy(payments.currency, payments.status);
    const ai = await tx.select({ provider: aiAttemptObservations.provider, model: aiAttemptObservations.model, outcome: aiAttemptObservations.outcome,
      count: sql<number>`count(*)::int`,
      tokenObserved: sql<number>`count(*) filter (where ${aiAttemptObservations.inputTokens} is not null and ${aiAttemptObservations.outputTokens} is not null)::int`,
      inputTokens: sql<string | null>`sum(${aiAttemptObservations.inputTokens})::text`, outputTokens: sql<string | null>`sum(${aiAttemptObservations.outputTokens})::text`,
      costObserved: sql<number>`count(${aiAttemptObservations.providerCostUsd})::int`, providerCostUsd: sql<string | null>`sum(${aiAttemptObservations.providerCostUsd})::text`,
      averageMs: sql<number>`round(avg(${aiAttemptObservations.durationMs}))::int` })
      .from(aiAttemptObservations).where(and(eq(aiAttemptObservations.tenantId, tenantId), gte(aiAttemptObservations.createdAt, windowStart)))
      .groupBy(aiAttemptObservations.provider, aiAttemptObservations.model, aiAttemptObservations.outcome)
      .orderBy(aiAttemptObservations.provider, aiAttemptObservations.model, aiAttemptObservations.outcome).limit(100);
    const sourceStates = await tx.select({ active: userSources.isActive, status: userSources.lastFetchStatus,
      count: sql<number>`count(*)::int`, lastFetchedAt: sql<string | null>`max(${userSources.lastFetchedAt})::text` })
      .from(userSources).where(eq(userSources.tenantId, tenantId)).groupBy(userSources.isActive, userSources.lastFetchStatus).orderBy(userSources.isActive, userSources.lastFetchStatus).limit(100);
    const [content] = await tx.select({
      articles: sql<number>`count(*)::int`, canonicalIdentified: sql<number>`count(${inboxItems.canonicalUrl})::int`,
      distinctCanonicals: sql<number>`count(distinct ${inboxItems.canonicalUrl})::int`,
      qualityMeasured: sql<number>`count(${inboxItems.qualityMetadata})::int`,
      averageRelevance: sql<string | null>`avg(${inboxItems.relevanceScore})::text`,
      fresh: sql<number>`count(*) filter (where ${inboxItems.publishedAt} >= ${new Date(now.getTime() - 48 * 60 * 60_000)} and ${inboxItems.publishedAt} <= ${now})::int`,
    }).from(inboxItems).where(and(eq(inboxItems.tenantId, tenantId), gte(inboxItems.discoveredAt, windowStart)));
    if (!content) throw new Error("Content measurements unavailable");
    const availability = await tx.execute(sql`select to_regclass('public.draft_feedback_events') is not null as available`);
    if (typeof availability.rows[0]?.available !== "boolean") throw new Error("Feedback availability measurement unavailable");
    const feedback = availability.rows[0]?.available === true ? await tx.select({ event: draftFeedbackEvents.eventType, count: sql<number>`count(*)::int` })
      .from(draftFeedbackEvents).where(and(eq(draftFeedbackEvents.tenantId, tenantId), gte(draftFeedbackEvents.createdAt, windowStart)))
      .groupBy(draftFeedbackEvents.eventType).orderBy(draftFeedbackEvents.eventType).limit(100) : null;
    return { generatedAt: now.toISOString(), windowStart: windowStart.toISOString(), generation, payments: paymentTotals, ai, sourceStates, content, feedback };
  });
}
