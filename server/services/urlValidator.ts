import pLimit from "p-limit";
import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import net from "node:net";

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
  try {
    const { fetchPublicText } = await import("./crawlerFetch.js");
    const response = await fetchPublicText(url, { timeoutMs });
    return { ok: true, status: response.status };
  } catch {
    return { ok: false };
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

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a >= 224) return true; // multicast, reserved, broadcast
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
    if (a === 192 && b === 88 && c === 99) return true;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    return false;
  }
  if (net.isIPv6(ip)) {
    // Only global unicast. This also excludes ALL mapped IPv4, NAT64,
    // link-local fe80::/10, scoped addresses, multicast and compatible IPv4.
    return ip.includes("%") || !globalV6.check(ip, "ipv6") || specialV6.check(ip, "ipv6");
  }
  return true; // unrecognized format - block to be safe
}

const globalV6 = new net.BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const specialV6 = new net.BlockList();
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) {
  specialV6.addSubnet(address, prefix, "ipv6");
}

/**
 * SSRF guard for any URL a user submits for the server to fetch (custom
 * Discover sources, feed autodiscovery). Resolves the hostname and checks the
 * actual IP(s), not just the string, so a public-looking domain that
 * DNS-rebinds to a private/internal address is still blocked.
 */
export async function resolvePublicHttpUrl(rawUrl: string): Promise<{ ok: true; records: LookupAddress[] } | { ok: false; reason: string }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "That doesn't look like a valid URL." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "Only http:// and https:// URLs are allowed." };
  }

  if (parsed.username || parsed.password) return { ok: false, reason: "URLs containing credentials are not allowed." };
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    return { ok: false, reason: "This host isn't allowed." };
  }

  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const records = net.isIP(hostname)
      ? [{ address: hostname, family: net.isIP(hostname) }]
      : await Promise.race([
          dns.lookup(hostname, { all: true }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("DNS timeout")), 2000); }),
        ]).finally(() => clearTimeout(timer));
    if (records.length === 0) return { ok: false, reason: "Couldn't resolve this host." };
    if (records.some((record) => isPrivateIp(record.address))) {
      return { ok: false, reason: "This host resolves to a private/internal address and isn't allowed." };
    }
    return { ok: true, records };
  } catch {
    return { ok: false, reason: "Couldn't resolve this host." };
  }

}

/** Validation alone is not rebinding protection; crawlers must use the pinned transport. */
export async function assertPublicHttpUrl(rawUrl: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const result = await resolvePublicHttpUrl(rawUrl);
  return result.ok ? { ok: true } : result;
}
