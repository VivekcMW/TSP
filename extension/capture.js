// Shared by the popup, the options page and the background service worker. No dependencies.

export const DEFAULT_APP_URL = "https://www.thesocialpundit.com";
export const SELECTION_LIMIT = 2000;
export const NOTE_LIMIT = 1000;
const TOKEN_PATTERN = /^tsp_cap_[A-Za-z0-9_-]{43}$/;

export class CaptureError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind; // "setup" | "network" | "page" | "server"
  }
}

/** The app origin, or null. HTTPS only, except http://localhost for local development. */
export function normalizeAppUrl(value) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch { return null; }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.username || url.password) return null;
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
  return url.origin;
}

export function isValidKey(value) {
  return TOKEN_PATTERN.test(String(value || "").trim());
}

/** Chrome match pattern for the app's host (match patterns ignore ports). */
export function hostPattern(origin) {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

export async function getSettings() {
  const { appUrl, token } = await chrome.storage.local.get(["appUrl", "token"]);
  return { appUrl: normalizeAppUrl(appUrl) || DEFAULT_APP_URL, token: typeof token === "string" ? token : "" };
}

export function isSavableUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

/** Sends one page to POST /api/capture. Resolves with the server's reply, or throws CaptureError. */
export async function saveToShortlist({ url, title, selection, note }) {
  if (!isSavableUrl(url)) throw new CaptureError("Only web pages (http or https) can be saved.", "page");
  const { appUrl, token } = await getSettings();
  if (!isValidKey(token)) throw new CaptureError("Add your TheSocialPundit key in the extension options first.", "setup");
  const body = { url, title: String(title || "").slice(0, 300) };
  const quote = String(selection || "").trim().slice(0, SELECTION_LIMIT);
  const text = String(note || "").trim().slice(0, NOTE_LIMIT);
  if (quote) body.selection = quote;
  if (text) body.note = text;

  let response;
  try {
    response = await fetch(`${appUrl}/api/capture`, {
      method: "POST",
      credentials: "omit",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CaptureError(`Could not reach ${appUrl}. Check the app address in the options.`, "network");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.message === "string" ? data.message : `Not saved (error ${response.status}).`;
    throw new CaptureError(message, response.status === 401 ? "setup" : "server");
  }
  return data;
}
