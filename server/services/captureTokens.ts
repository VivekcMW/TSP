import { createHash, randomBytes } from "node:crypto";
import type { RequestHandler, Response } from "express";

/** Token-authenticated save-from-any-page endpoint used by the extension and bookmarklet. */
export const CAPTURE_PATH = "/api/capture";
export const CAPTURE_TOKEN_PREFIX = "tsp_cap_";
export const CAPTURE_NOTE_LIMIT = 1000;
export const CAPTURE_SELECTION_LIMIT = 2000;
const CAPTURE_TOKEN_PATTERN = /^tsp_cap_[A-Za-z0-9_-]{43}$/;
const NOTE_TITLE_LIMIT = 120;

export interface GeneratedSecret { token: string; hash: string; hint: string }

/** Lowercase hex SHA-256: the only form of a bearer secret that is stored or compared. */
export function hashSecretToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateCaptureToken(): GeneratedSecret {
  const token = `${CAPTURE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashSecretToken(token), hint: token.slice(-4) };
}

export function isCaptureTokenFormat(token: string): boolean {
  return CAPTURE_TOKEN_PATTERN.test(token);
}

export function readBearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

export function isCapturePath(path: string): boolean {
  return path.replace(/\/+$/, "").toLowerCase() === CAPTURE_PATH;
}

function setCaptureCorsHeaders(res: Response) {
  // Any page may call this endpoint, but never with cookies: the bearer key is the only credential.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "Retry-After");
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("Cache-Control", "no-store");
}

/** CORS for /api/capture only; answers preflight itself. */
export const captureCors: RequestHandler = (req, res, next) => {
  setCaptureCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
};

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** "From <title>: “<selection>” — <note>", within the 1000-character note limit. The user's own note keeps priority. */
export function captureNoteText(input: { title: string; selection?: string | null; note?: string | null }): string | null {
  const selection = (input.selection ?? "").replace(/\s+/g, " ").trim();
  let note = (input.note ?? "").trim();
  if (!selection && !note) return null;
  const prefix = `From ${clip(input.title.replace(/\s+/g, " ").trim() || "a saved page", NOTE_TITLE_LIMIT)}: `;
  const quoteMarks = selection ? 2 : 0;
  const separator = selection && note ? 3 : 0;
  const reservedForQuote = selection ? Math.min(selection.length, 80) : 0;
  note = clip(note, Math.max(1, CAPTURE_NOTE_LIMIT - prefix.length - quoteMarks - separator - reservedForQuote));
  const quote = selection ? clip(selection, Math.max(1, CAPTURE_NOTE_LIMIT - prefix.length - quoteMarks - separator - note.length)) : "";
  return `${prefix}${quote ? `“${quote}”` : ""}${quote && note ? " — " : ""}${note}`;
}
