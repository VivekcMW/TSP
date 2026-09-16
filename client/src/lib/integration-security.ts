import { ApiError } from "./queryClient";
import type { QueryStatus } from "./gate";

export function isAuthenticationError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

/** Only availability failures may fall back to already resolved data. */
export function gateQueryStatus(data: unknown, error: unknown): QueryStatus {
  if (error) {
    const unavailable = !(error instanceof ApiError) || error.status >= 500 || [408, 429].includes(error.status);
    return data != null && unavailable ? "ok" : "error";
  }
  return data === undefined ? "loading" : "ok";
}

/** Preserve callback context; explicit destination parameters always win. */
export function dashboardRedirectTarget(to: string, search: string): string {
  const [pathname, destinationSearch = ""] = to.split("?");
  const params = new URLSearchParams(search);
  new URLSearchParams(destinationSearch).forEach((value, key) => params.set(key, value));
  const query = params.toString();
  return pathname + (query ? `?${query}` : "");
}