import type { Express } from "express";
import { linkedInPostToolRequest } from "@shared/linkedin-post-tool";
import { publicPostToolGlobalRateLimit, publicPostToolRateLimit } from "../middlewares/rateLimit";
import { CrawlError } from "../services/crawlerFetch";
import { getAIErrorResponse } from "../services/openRouter";
import { generatePublicLinkedInPost, PublicPostToolBusyError } from "../services/publicPostTool";

export function registerPublicToolRoutes(app: Express) {
  // Per-visitor allowance first, so a visitor already over their limit never spends the site-wide budget.
  app.post("/api/public/tools/linkedin-post", publicPostToolRateLimit, publicPostToolGlobalRateLimit, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = linkedInPostToolRequest.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "invalid_input", message: "Paste a public article link, or at least a few paragraphs of article text, and choose a tone." });
    }
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.on("close", cancel);
    try {
      res.json(await generatePublicLinkedInPost(parsed.data, controller.signal));
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof PublicPostToolBusyError) {
        res.setHeader("Retry-After", "10");
        return res.status(503).json({ code: "tool_busy", message: error.message });
      }
      if (error instanceof CrawlError) {
        return res.status(422).json({ code: "source_unreadable", message: `${error.message} Paste the article text instead.` });
      }
      const failure = getAIErrorResponse(error);
      console.error("Public LinkedIn post tool failed:", failure.body.code);
      if (failure.retryAfterSeconds) res.setHeader("Retry-After", failure.retryAfterSeconds);
      res.status(failure.status).json(failure.body);
    } finally {
      res.off("close", cancel);
    }
  });
}
