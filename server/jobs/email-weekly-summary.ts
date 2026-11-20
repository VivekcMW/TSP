import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { tenantMembers, tenants, users } from "@shared/schema";
import type { TenantScope } from "../storage";
import { getEmailPreferences } from "../services/email/preferences";
import { digestSlot, preferenceEnabled } from "../services/email/policy";
import { deliverAppEmail, emailTemplates } from "../services/email";

export function weeklySummaryWindow(now: Date, timezone: string, time: string) {
  const slot = digestSlot(now, timezone, time);
  if (!slot) return undefined;
  const monday = new Date(`${slot}T00:00:00Z`);
  if (monday.getUTCDay() !== 1) return undefined;
  const dateBefore = (days: number) => new Date(monday.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  return { slot, weekStart: dateBefore(7), weekEnd: dateBefore(1) };
}

export async function loadWeeklySummary(scope: TenantScope, weekStart: string, nextMonday: string, timezone: string) {
  const [recipient] = await db.select({ email: users.email, name: users.name, workspace: tenants.name })
    .from(tenantMembers).innerJoin(users, eq(users.id, tenantMembers.userId)).innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .where(and(eq(tenantMembers.tenantId, scope.tenantId), eq(tenantMembers.userId, scope.userId), eq(tenants.status, "active"), eq(users.emailVerified, true))).limit(1);
  if (!recipient) return null;
  const metrics = await db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.tenant_id', ${scope.tenantId}, true)`);
    // Boundaries are local calendar midnights, not a fixed 168-hour UTC window.
    const start = sql`(${weekStart}::date::timestamp at time zone ${timezone})`;
    const end = sql`(${nextMonday}::date::timestamp at time zone ${timezone})`;
    const [counts] = (await tx.execute<{ articles: number; drafts: number; published: number }>(sql`select
      (select count(*)::int from inbox_items
        where tenant_id = ${scope.tenantId} and user_id = ${scope.userId}
          and discovered_at >= ${start} and discovered_at < ${end}) as articles,
      (select count(*)::int from drafts
        where tenant_id = ${scope.tenantId} and user_id = ${scope.userId}
          and created_at at time zone 'UTC' >= ${start} and created_at at time zone 'UTC' < ${end}) as drafts,
      (select count(distinct d.id)::int from drafts d
        inner join draft_schedules s on s.draft_id = d.id and s.tenant_id = d.tenant_id
        inner join draft_schedule_targets t on t.draft_schedule_id = s.id and t.tenant_id = d.tenant_id
        where d.tenant_id = ${scope.tenantId} and d.user_id = ${scope.userId}
          and t.status = 'published' and t.execution_mode = 'live' and t.receipt_kind = 'provider_id'
          and nullif(trim(t.provider_post_id), '') is not null
          and t.provider_post_id !~* '^(sandbox|mock|dryrun|dry-run)[_-]'
          and t.published_at at time zone 'UTC' >= ${start} and t.published_at at time zone 'UTC' < ${end}) as published`)).rows;
    if (!counts) throw new Error("Weekly summary counts unavailable");
    return counts;
  });
  return { ...recipient, ...metrics };
}

type Deps = {
  getEmailPreferences: typeof getEmailPreferences;
  loadWeeklySummary: typeof loadWeeklySummary;
  deliverAppEmail: typeof deliverAppEmail;
};
export async function sendWeeklySummaryForScope(scope: TenantScope, now = new Date(), deps: Deps = { getEmailPreferences, loadWeeklySummary, deliverAppEmail }) {
  const preferences = await deps.getEmailPreferences(scope.userId);
  if (!preferenceEnabled("weekly_summary", preferences)) return;
  const window = weeklySummaryWindow(now, preferences.digestTimezone, preferences.digestTime);
  if (!window) return;
  const summary = await deps.loadWeeklySummary(scope, window.weekStart, window.slot, preferences.digestTimezone);
  if (!summary) return;
  await deps.deliverAppEmail({
    type: "weekly_summary", userId: scope.userId, recipient: summary.email, recipientName: summary.name,
    dedupeKey: JSON.stringify(["weekly-summary-v1", scope.tenantId, scope.userId, window.slot]),
    ...emailTemplates.weeklySummary({ ...summary, weekStart: window.weekStart, weekEnd: window.weekEnd }),
  });
}
