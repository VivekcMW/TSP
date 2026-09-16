import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { createAccountCache } from "./account-cache";

/**
 * Carries the HTTP status alongside the message so callers can act on the
 * server's error contract: 401 = no valid session (sign out), 422 = valid
 * session but unusable account (terminal), 5xx = server fault (retryable).
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let errorMessage = res.statusText;
    try {
      const errorData = await res.json();
      errorMessage = errorData.message || JSON.stringify(errorData);
    } catch {
      // If JSON parsing fails, try text
      try {
        errorMessage = await res.text() || res.statusText;
      } catch {
        // Keep default statusText
      }
    }
    const retryAfter = res.headers.get("Retry-After");
    let delay = Number.NaN;
    if (retryAfter !== null) delay = /^\d+(\.\d+)?$/.test(retryAfter)
      ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
    throw new ApiError(res.status, errorMessage, Number.isFinite(delay) ? Math.max(0, delay) : undefined);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown,
  options?: { headers?: Record<string, string>; signal?: AbortSignal },
): Promise<Response> {
  if (accountCache.getSnapshot().signingOut) throw new DOMException("Signing out", "AbortError");
  // A cached /api/me row is enough to retain local work, not to authorize new
  // writes during an account outage. Profile/publishing readiness remains owned
  // by the existing consumers; recovery GETs and auth-client sign-out still work.
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) && queryClient.getQueryState(["/api/me"])?.error) {
    throw new ApiError(503, "Account information is unavailable. Retry account information before making changes. Your work is retained.");
  }
  const headers = new Headers(options?.headers);
  const signal = options?.signal ? AbortSignal.any([options.signal, accountCache.getSignal()]) : accountCache.getSignal();
  if (data) headers.set("Content-Type", "application/json");
  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
    signal,
  });

  signal.throwIfAborted();
  await throwIfResNotOk(res);
  signal.throwIfAborted();
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey, signal }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      signal,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

export const accountCache = createAccountCache(queryClient);
