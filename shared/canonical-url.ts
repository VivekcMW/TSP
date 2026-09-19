// Deliberately explicit: unknown parameters (including ref, source, redirect
// targets and signatures) are meaningful until proven otherwise. No network IO.
const TRACKING_PARAMETERS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "gclid", "dclid", "fbclid", "msclkid", "mc_cid", "mc_eid",
]);

export function canonicalHttpUrl(input: string): string | null {
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    // Do not use URLSearchParams.toString(): it changes encoding of meaningful
    // parameters. Preserve order, duplicates, values and path case/slashes.
    const parts = url.search.slice(1).split("&").filter(part => {
      const key = part.split("=", 1)[0];
      try { return !TRACKING_PARAMETERS.has(decodeURIComponent(key.replace(/\+/g, " "))); }
      catch { return true; }
    });
    const query = parts.join("&");
    // The setter consumes one leading '?' as its delimiter, not query data.
    url.search = query ? `?${query}` : "";
    return url.href;
  } catch { return null; }
}