import type { Express, Request, Response } from "express";
import type { ZodType } from "zod";
import { linkedInPostToolRequest } from "@shared/linkedin-post-tool";
import { linkedInHookToolRequest } from "@shared/linkedin-hook-tool";
import { linkedInHashtagToolRequest } from "@shared/linkedin-hashtag-tool";
import {
  publicHashtagToolRateLimits, publicHookToolRateLimits, publicPostToolGlobalRateLimit, publicPostToolRateLimit,
} from "../middlewares/rateLimit";
import { CrawlError } from "../services/crawlerFetch";
import { getAIErrorResponse } from "../services/openRouter";
import { generatePublicLinkedInPost } from "../services/publicPostTool";
import { generatePublicLinkedInHashtags, generatePublicLinkedInHooks } from "../services/publicMiniTools";
import { PublicToolBusyError } from "../services/publicToolSlots";

/**
 * Validates the body, runs the generator with a signal that aborts when the visitor leaves, and
 * maps failures to the public error contract shared by every free tool.
 */
function toolHandler<T>(name: string, schema: ZodType<T>, invalidMessage: string, generate: (input: T, signal: AbortSignal) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: "invalid_input", message: invalidMessage });
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.on("close", cancel);
    try {
      res.json(await generate(parsed.data, controller.signal));
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof PublicToolBusyError) {
        res.setHeader("Retry-After", "10");
        return res.status(503).json({ code: "tool_busy", message: error.message });
      }
      if (error instanceof CrawlError) {
        return res.status(422).json({ code: "source_unreadable", message: `${error.message} Paste the article text instead.` });
      }
      const failure = getAIErrorResponse(error);
      console.error(`Public ${name} tool failed:`, failure.body.code);
      if (failure.retryAfterSeconds) res.setHeader("Retry-After", failure.retryAfterSeconds);
      res.status(failure.status).json(failure.body);
    } finally {
      res.off("close", cancel);
    }
  };
}

export function registerPublicToolRoutes(app: Express) {
  // Per-visitor allowance first, so a visitor already over their limit never spends the site-wide budget.
  app.post("/api/public/tools/linkedin-post", publicPostToolRateLimit, publicPostToolGlobalRateLimit, toolHandler(
    "LinkedIn post", linkedInPostToolRequest,
    "Paste a public article link, or at least a few paragraphs of article text, and choose a tone.",
    generatePublicLinkedInPost,
  ));

  app.post("/api/public/tools/linkedin-hooks", publicHookToolRateLimits.perVisitor, publicHookToolRateLimits.global, toolHandler(
    "LinkedIn hook", linkedInHookToolRequest,
    "Describe what your post is about in at least a sentence, or paste your draft.",
    generatePublicLinkedInHooks,
  ));

  app.post("/api/public/tools/linkedin-hashtags", publicHashtagToolRateLimits.perVisitor, publicHashtagToolRateLimits.global, toolHandler(
    "LinkedIn hashtag", linkedInHashtagToolRequest,
    "Paste your post, or describe its topic in at least a sentence.",
    generatePublicLinkedInHashtags,
  ));
}
