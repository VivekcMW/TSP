import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { adminIncidents, auditLog } from "@shared/schema";
import { getQueueHealth } from "../jobs/queue";
import { readWorkerHealth } from "../jobs/worker-health";
import { readSchedulerExecutionHealth } from "../jobs/execution-health";
import { waitingAge } from "./admin-jobs";
import { AdminControlConflict } from "./admin-quotas";

export async function operationalSnapshot() {
  const queue = await getQueueHealth();
  const [workers, execution] = await Promise.all([readWorkerHealth(), readSchedulerExecutionHealth()]);
  const ages = queue.reachable && queue.queuesReady
    ? { inbox: await waitingAge("inbox"), publishing: await waitingAge("publishing") } : null;
  return { generatedAt: new Date().toISOString(), queue, workers, execution, ages,
    expected: process.env.BACKGROUND_JOBS_ENABLED === "true" && process.env.NODE_ENV === "production" };
}
export type OperationalSnapshot = Awaited<ReturnType<typeof operationalSnapshot>>;
export function incidentSignals(snapshot: OperationalSnapshot) {
  const signals: { signal: string; active: boolean; severity: "warning" | "critical"; summary: string }[] = [];
  if (!snapshot.expected) return signals;
  signals.push({ signal: "queue:unavailable", active: !snapshot.queue.reachable || !snapshot.queue.queuesReady, severity: "critical", summary: "Required background queues unavailable" });
  if (snapshot.workers.available) {
    for (const kind of ["inbox", "publishing"] as const) signals.push({
      signal: `workers:${kind}`, active: snapshot.workers[kind] === 0, severity: "critical", summary: `No recent ${kind} worker heartbeat`,
    });
  }
  if (snapshot.ages) for (const kind of ["inbox", "publishing"] as const) {
    const age = snapshot.ages[kind];
    if (age.available && (age.complete || (age.oldestMs ?? 0) > 15 * 60_000)) signals.push({
      signal: `queue:age:${kind}`, active: (age.oldestMs ?? 0) > 15 * 60_000, severity: "warning", summary: `${kind} waiting work exceeds fifteen minutes`,
    });
  }
  if (snapshot.execution.available) for (const task of snapshot.execution.tasks) signals.push({
    signal: `scheduler:${task.name}`, active: ["failed", "stale", "never_observed"].includes(task.state),
    severity: "warning", summary: `Scheduler ${task.name} has no recent successful cycle`,
  });
  return signals;
}
export async function synchronizeIncidents() {
  const snapshot = await operationalSnapshot();
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('admin:incidents', 0))`);
    for (const signal of incidentSignals(snapshot)) {
      const [previous] = await tx.select().from(adminIncidents).where(eq(adminIncidents.signal, signal.signal)).limit(1);
      if (!signal.active && (!previous || previous.state === "resolved")) continue;
      const now = new Date();
      if (signal.active) {
        if (previous) await tx.update(adminIncidents).set({ state: previous.state === "resolved" ? "open" : previous.state,
          lastSeenAt: now, resolvedAt: null, acknowledgedBy: previous.state === "resolved" ? null : previous.acknowledgedBy,
          version: previous.version + 1 }).where(eq(adminIncidents.id, previous.id));
        else await tx.insert(adminIncidents).values({ signal: signal.signal, severity: signal.severity, summary: signal.summary, state: "open", lastSeenAt: now });
      } else await tx.update(adminIncidents).set({ state: "resolved", resolvedAt: now, version: previous.version + 1 }).where(eq(adminIncidents.id, previous.id));
      if (!previous || previous.state === "resolved" || !signal.active) await tx.insert(auditLog).values({
        action: signal.active ? "incident.opened" : "incident.resolved", resourceType: "incident", resourceId: signal.signal,
        justification: "Authoritative operational observation", metadata: { automatic: true },
      });
    }
  });
  return snapshot;
}
export function listIncidents(page: number) {
  return db.select().from(adminIncidents).orderBy(desc(adminIncidents.lastSeenAt), adminIncidents.id).limit(26).offset((page - 1) * 25);
}
export async function transitionIncident(id: string, state: "acknowledged" | "resolved", version: number, actorId: string, reason: string) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('admin:incidents', 0))`);
    const [row] = await tx.update(adminIncidents).set({ state, acknowledgedBy: actorId,
      resolvedAt: state === "resolved" ? new Date() : null, version: version + 1 })
      .where(and(eq(adminIncidents.id, id), eq(adminIncidents.version, version),
        state === "acknowledged" ? eq(adminIncidents.state, "open") : sql`${adminIncidents.state} in ('open', 'acknowledged')`)).returning();
    if (!row) throw new AdminControlConflict("Incident changed or transition is invalid. Refresh before acting.");
    await tx.insert(auditLog).values({ action: `incident.${state}`, actorUserId: actorId, resourceType: "incident", resourceId: id,
      justification: reason, metadata: { automatic: false, fromVersion: version, toVersion: row.version } });
    return row;
  });
}
