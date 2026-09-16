import cron from "node-cron";
import { enqueueInboxRefresh, enqueuePublishDraft } from "./queue";
import { storage } from "../storage";
import { pool } from "../db";

interface ScheduleStats {
  activeUsersSelected: number;
  topUsersSelected: number;
  jobsQueued: number;
}

/**
 * Get all active users (those with inbox items or drafts in the last 30 days).
 * Returns a list of { tenantId, userId } pairs for active users.
 */
async function getActiveUsers(): Promise<Array<{ tenantId: string; userId: string }>> {
  try {
    const result = await pool.query(
      `
      SELECT DISTINCT tenant_id, user_id FROM (
        SELECT tenant_id, user_id FROM inbox_items 
        WHERE created_at > now() - interval '30 days'
        UNION
        SELECT tenant_id, user_id FROM drafts
        WHERE updated_at > now() - interval '30 days'
      ) as active_users
      `
    );

    return result.rows.map((row: any) => ({
      tenantId: row.tenant_id,
      userId: row.user_id,
    }));
  } catch (error) {
    console.error("[scheduler] Error fetching active users:", error);
    return [];
  }
}

/**
 * Get top-engagement users (top 25% by saved/drafted articles).
 * These users are more active and get higher priority refresh.
 */
async function getTopEngagementUsers(limit: number = 50): Promise<Array<{ tenantId: string; userId: string }>> {
  try {
    const result = await pool.query(
      `
      SELECT DISTINCT tenant_id, user_id FROM (
        SELECT 
          tenant_id,
          user_id,
          COUNT(*) as total_engagement
        FROM (
          SELECT tenant_id, user_id FROM inbox_items WHERE status = 'saved'
          UNION ALL
          SELECT tenant_id, user_id FROM drafts WHERE status != 'draft'
        ) as engagement
        GROUP BY tenant_id, user_id
        ORDER BY total_engagement DESC
        LIMIT $1
      ) as top_users
      `,
      [limit]
    );

    return result.rows.map((row: any) => ({
      tenantId: row.tenant_id,
      userId: row.user_id,
    }));
  } catch (error) {
    console.error("[scheduler] Error fetching top engagement users:", error);
    return [];
  }
}

/**
 * Schedule a cron job to refresh inboxes of active users.
 * Runs every N minutes at low priority (background pre-warming).
 *
 * @param intervalMinutes - Minutes between refreshes (default: 360 = 6 hours)
 */
export function scheduleActiveUserRefresh(intervalMinutes: number = 360): string {
  const expression = `*/${Math.max(1, intervalMinutes)} * * * *`; // Every N minutes

  console.log(`[scheduler] Active user refresh scheduled: every ${intervalMinutes} minutes`);

  cron.schedule(expression, async () => {
    console.log(`[scheduler] Starting active user refresh cycle`);

    try {
      const users = await getActiveUsers();
      console.log(`[scheduler] Found ${users.length} active users`);

      let queued = 0;
      for (const { tenantId, userId } of users) {
        const jobId = await enqueueInboxRefresh({
          tenantId,
          userId,
          priority: "low", // Low priority for batch pre-warming
          triggeredBy: "cron",
        });

        if (jobId) {
          queued++;
          // Rate limit: queue one job per second to avoid thundering herd
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      console.log(`[scheduler] Active user refresh cycle complete: ${queued} jobs queued`);
    } catch (error) {
      console.error("[scheduler] Error in active user refresh cycle:", error);
    }
  });

  return expression;
}

/**
 * Schedule a cron job to refresh inboxes of high-engagement users.
 * Runs more frequently than the general refresh.
 * Runs every N minutes at normal priority.
 *
 * @param intervalMinutes - Minutes between refreshes (default: 30)
 */
export function scheduleTopUserRefresh(intervalMinutes: number = 30): string {
  const expression = `*/${Math.max(1, intervalMinutes)} * * * *`; // Every N minutes

  console.log(`[scheduler] Top user refresh scheduled: every ${intervalMinutes} minutes`);

  cron.schedule(expression, async () => {
    console.log(`[scheduler] Starting top user refresh cycle`);

    try {
      const users = await getTopEngagementUsers(50); // Top 50 users
      console.log(`[scheduler] Found ${users.length} top engagement users`);

      let queued = 0;
      for (const { tenantId, userId } of users) {
        const jobId = await enqueueInboxRefresh({
          tenantId,
          userId,
          priority: "high", // High priority for engaged users
          triggeredBy: "cron",
        });

        if (jobId) {
          queued++;
          // No rate limiting here since we're only doing ~50 jobs
        }
      }

      console.log(`[scheduler] Top user refresh cycle complete: ${queued} jobs queued`);
    } catch (error) {
      console.error("[scheduler] Error in top user refresh cycle:", error);
    }
  });

  return expression;
}

/**
 * Schedule a cron job to publish drafts that are due for publication.
 * Runs every N minutes to check for scheduled drafts that should be published now.
 *
 * @param intervalMinutes - Minutes between publish checks (default: 1 = every minute)
 */
export function schedulePublishRefresh(intervalMinutes: number = 1): string {
  const expression = `*/${Math.max(1, intervalMinutes)} * * * *`; // Every N minutes

  console.log(`[scheduler] Publish refresh scheduled: every ${intervalMinutes} minute(s)`);

  cron.schedule(expression, async () => {
    console.log(`[scheduler] Starting publish refresh cycle`);

    try {
      // Get all scheduled drafts that are due for publishing
      const scheduledDrafts = await storage.getScheduledDraftsForPublishing(50);
      console.log(`[scheduler] Found ${scheduledDrafts.length} drafts due for publishing`);

      let queued = 0;
      for (const schedule of scheduledDrafts) {
        try {
          // Cross-tenant scheduler lookup: use the owner DB query because RLS
          // requires a tenant/user scope that is not known until this row is read.
          const draftResult = await pool.query(
            "SELECT platform, user_id FROM drafts WHERE id = $1 AND tenant_id = $2",
            [schedule.draftId, schedule.tenantId]
          );

          if (draftResult.rows.length === 0) {
            console.log(`[scheduler] Draft ${schedule.draftId} not found, skipping`);
            continue;
          }

          const userId = draftResult.rows[0].user_id;
          const targets = await storage.getDraftScheduleTargetsForPublishing(schedule.id);
          const platforms = targets.length ? targets : [{ id: `${schedule.id}:legacy`, platform: draftResult.rows[0].platform }];

          // Update schedule status to queued
          await storage.updateDraftScheduleStatus({ tenantId: schedule.tenantId, userId }, schedule.id, "queued");

          for (const target of platforms) {
            const jobId = await enqueuePublishDraft({
              tenantId: schedule.tenantId,
              userId,
              draftId: schedule.draftId,
              draftScheduleId: schedule.id,
              draftScheduleTargetId: target.id,
              platform: target.platform,
              publishAt: schedule.scheduledPublishAt,
              attemptNumber: 1,
            });
            if (jobId) queued++;
          }
          console.log(`[scheduler] Enqueued ${platforms.length} publish target(s) for draft ${schedule.draftId}`);
        } catch (error) {
          console.error(`[scheduler] Error processing draft ${schedule.draftId}:`, error);
        }
      }

      console.log(`[scheduler] Publish refresh cycle complete: ${queued} jobs queued`);
    } catch (error) {
      console.error("[scheduler] Error in publish refresh cycle:", error);
    }
  });

  return expression;
}

/**
 * Initialize all scheduler tasks.
 * Only runs if BACKGROUND_JOBS_ENABLED=true and this is a scheduler instance.
 */
export async function initializeScheduler(): Promise<boolean> {
  const backgroundJobsEnabled = process.env.BACKGROUND_JOBS_ENABLED === "true";
  const isScheduler = process.env.CRON_SCHEDULER === "true";
  const nodeEnv = process.env.NODE_ENV;

  if (!backgroundJobsEnabled) {
    console.log("[scheduler] Background jobs disabled, scheduler not started");
    return false;
  }

  if (nodeEnv !== "production") {
    console.log("[scheduler] Not in production, scheduler disabled (local dev only)");
    return false;
  }

  if (!isScheduler) {
    console.log("[scheduler] Not designated as scheduler instance (CRON_SCHEDULER != true)");
    return false;
  }

  try {
    // Schedule active user refresh (every 6 hours by default)
    const activeInterval = Number.parseInt(process.env.CRON_REFRESH_INTERVAL || "360");
    scheduleActiveUserRefresh(activeInterval);

    // Schedule top user refresh (every 30 minutes by default)
    const topUserInterval = Number.parseInt(process.env.CRON_REFRESH_TOPUSERS_INTERVAL || "30");
    scheduleTopUserRefresh(topUserInterval);

    // Schedule draft publish refresh (every minute by default)
    const publishInterval = Number.parseInt(process.env.CRON_PUBLISH_INTERVAL || "1");
    schedulePublishRefresh(publishInterval);

    console.log("[scheduler] All scheduler tasks initialized successfully");
    return true;
  } catch (error) {
    console.error("[scheduler] Failed to initialize scheduler:", error);
    return false;
  }
}

/**
 * Stop all scheduler tasks.
 * Called on graceful shutdown.
 */
export async function stopScheduler(): Promise<void> {
  cron.getTasks().forEach((task) => {
    task.stop();
  });
  console.log("[scheduler] All scheduler tasks stopped");
}
