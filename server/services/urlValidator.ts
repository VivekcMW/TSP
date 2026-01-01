import pLimit from "p-limit";

const limit = pLimit(5);

export interface UrlValidationResult {
  isValid: boolean;
  url: string;
  reason?: string;
}

const BLOCKED_DOMAINS = [
  "example.com",
  "example.org",
  "example.net",
  "localhost",
  "127.0.0.1",
];

export function isValidUrlFormat(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function isBlockedDomain(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return BLOCKED_DOMAINS.some((domain) => 
      hostname === domain || hostname.endsWith(`.${domain}`)
    );
  } catch {
    return true;
  }
}

export function validateUrlSync(url: string): boolean {
  if (!url || url.trim() === "") return false;
  if (!isValidUrlFormat(url)) return false;
  if (isBlockedDomain(url)) return false;
  return true;
}

async function checkUrlReachability(url: string, timeoutMs: number = 5000): Promise<{ ok: boolean; status?: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headResponse = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: {
        "User-Agent": "TheSocialPundit/1.0 (URL Validator)",
      },
      redirect: "follow",
    });
    clearTimeout(timeoutId);
    
    if (headResponse.ok) {
      return { ok: true, status: headResponse.status };
    }
    
    if (headResponse.status === 404 || headResponse.status === 410) {
      return { ok: false, status: headResponse.status };
    }
    
    if (headResponse.status === 405 || headResponse.status === 401 || headResponse.status === 403) {
      return { ok: true, status: headResponse.status };
    }
    
    return { ok: true, status: headResponse.status };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: true, status: 408 };
    }
    
    const getController = new AbortController();
    const getTimeoutId = setTimeout(() => getController.abort(), timeoutMs);
    
    try {
      const getResponse = await fetch(url, {
        method: "GET",
        signal: getController.signal,
        headers: {
          "User-Agent": "TheSocialPundit/1.0 (URL Validator)",
          "Range": "bytes=0-1024",
        },
        redirect: "follow",
      });
      clearTimeout(getTimeoutId);
      
      if (getResponse.status === 404 || getResponse.status === 410) {
        return { ok: false, status: getResponse.status };
      }
      return { ok: true, status: getResponse.status };
    } catch {
      clearTimeout(getTimeoutId);
      return { ok: true };
    }
  }
}

export async function validateUrl(url: string, checkReachability: boolean = false): Promise<UrlValidationResult> {
  if (!url || url.trim() === "") {
    return { isValid: false, url, reason: "Empty URL" };
  }

  if (!isValidUrlFormat(url)) {
    return { isValid: false, url, reason: "Invalid URL format" };
  }

  if (isBlockedDomain(url)) {
    return { isValid: false, url, reason: "Blocked domain (example.com)" };
  }

  if (checkReachability) {
    const reachability = await checkUrlReachability(url);
    if (!reachability.ok) {
      return { 
        isValid: false, 
        url, 
        reason: reachability.status === 404 ? "URL returns 404" : `URL unreachable (${reachability.status || "error"})` 
      };
    }
  }

  return { isValid: true, url };
}

export async function filterValidUrls<T extends { articleUrl?: string; link?: string }>(
  items: T[],
  checkReachability: boolean = false
): Promise<T[]> {
  const validationPromises = items.map((item) => 
    limit(async () => {
      const url = item.articleUrl || item.link || "";
      const result = await validateUrl(url, checkReachability);
      return { item, result };
    })
  );

  const results = await Promise.all(validationPromises);
  
  const validItems = results
    .filter(({ result }) => result.isValid)
    .map(({ item }) => item);

  const invalidCount = items.length - validItems.length;
  if (invalidCount > 0) {
    console.log(`URL validation: filtered out ${invalidCount} articles with invalid URLs`);
  }

  return validItems;
}
