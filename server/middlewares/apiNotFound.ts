import type { Request, Response } from "express";

/** Mounted on /api after every API route: an unknown endpoint is a JSON 404, never the web app's page. */
export function apiNotFound(_req: Request, res: Response) {
  res.status(404).json({ code: "not_found", message: "This API endpoint does not exist." });
}
