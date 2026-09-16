import type { Express } from "express";
import { getJobStatus, getPublishDraftQueue } from "../jobs/queue";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { storage } from "../storage";

export function registerJobsRoutes(app: Express) {
  app.get("/api/jobs/overview", requireDbUser, requirePermission("draft:read:own"), async (req, res) => {
    try {
      const scope = authedOf(req).tenant;
      const [schedules, drafts] = await Promise.all([storage.getScheduledDrafts(scope, { limit: 200 }), storage.getDrafts(scope, { limit: 200 })]);
      const logs = (await Promise.all(drafts.map((draft) => storage.getPublishLogs(scope, draft.id)))).flat();
      const overdueCutoff = Date.now() - 5 * 60 * 1000;
      res.json({
        queueAvailable: Boolean(getPublishDraftQueue()),
        scheduled: schedules.filter((schedule) => schedule.status === "scheduled" || schedule.status === "queued").length,
        publishing: schedules.filter((schedule) => schedule.status === "publishing").length,
        failed: schedules.filter((schedule) => schedule.status === "failed").length,
        overdue: schedules.filter((schedule) => (schedule.status === "scheduled" || schedule.status === "queued") && new Date(schedule.scheduledPublishAt).getTime() < overdueCutoff).length,
        recentFailures: logs.filter((log) => log.status === "failed").slice(0, 10),
      });
    } catch (error) {
      console.error("Error fetching job overview:", error);
      res.status(500).json({ message: "Failed to fetch job overview" });
    }
  });

  // Get job status by ID
  app.get("/api/jobs/:jobId/status", requireDbUser, async (req, res) => {
    try {
      const { jobId } = req.params;

      const jobStatus = await getJobStatus(jobId);
      if (!jobStatus) {
        return res.status(404).json({ message: "Job not found" });
      }
      const scope = authedOf(req).tenant;
      if (jobStatus.data?.tenantId !== scope.tenantId || jobStatus.data?.userId !== scope.userId) {
        return res.status(404).json({ message: "Job not found" });
      }

      res.json(jobStatus);
    } catch (error) {
      console.error("Error fetching job status:", error);
      res.status(500).json({ message: "Failed to fetch job status" });
    }
  });
}
