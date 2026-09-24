/**
 * Analytics runs only with consent (GDPR, India's DPDP Act). Google Tag Manager is not
 * loaded at all until the visitor accepts; essential cookies (the sign-in session) are
 * unaffected. The choice lives in this browser and can be changed from "Cookie settings".
 */
export type AnalyticsConsent = "granted" | "denied";

export const GTM_ID = "GTM-P4Z2QFPV";
const STORAGE_KEY = "tsp-analytics-consent";
export const COOKIE_SETTINGS_EVENT = "tsp:cookie-settings";

export function readAnalyticsConsent(): AnalyticsConsent | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

/** Idempotent: inserts the Tag Manager script once per page. */
export function loadTagManager(): void {
  if (document.querySelector(`script[data-gtm="${GTM_ID}"]`)) return;
  const layer = ((window as unknown as { dataLayer?: unknown[] }).dataLayer ??= []);
  layer.push({ "gtm.start": Date.now(), event: "gtm.js" });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`;
  script.dataset.gtm = GTM_ID;
  document.head.appendChild(script);
}

function clearAnalyticsCookies(): void {
  const host = window.location.hostname;
  const domains = ["", host, `.${host.replace(/^www\./, "")}`];
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (!name || !/^(?:_ga|_gid|_gat)/.test(name)) continue;
    for (const domain of domains) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain ? `; domain=${domain}` : ""}`;
    }
  }
}

export function saveAnalyticsConsent(value: AnalyticsConsent): void {
  try { window.localStorage.setItem(STORAGE_KEY, value); } catch { /* the choice still applies to this page */ }
  if (value === "granted") loadTagManager();
  else clearAnalyticsCookies();
}

export function startAnalyticsIfConsented(): void {
  if (readAnalyticsConsent() === "granted") loadTagManager();
}

export function openCookieSettings(): void {
  window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT));
}
