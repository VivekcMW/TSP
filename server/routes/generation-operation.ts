import type { Request, Response } from "express";
import { authedOf } from "../middlewares/requireDbUser";
import { generationOperationId, runGeneration } from "../services/generation-quota";

export function runHttpGeneration<T>(req: Request, res: Response, kind: string, input: unknown,
  signal: AbortSignal, work: () => Promise<T>) {
  const id = generationOperationId(req.body?.requestIntent);
  res.setHeader("X-Generation-Operation-Id", id);
  res.setHeader("Cache-Control", "no-store");
  return runGeneration(authedOf(req).tenant, id, kind, input, signal, work);
}