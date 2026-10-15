/**
 * Analytics runs only with consent (GDPR, India's DPDP Act). Google Tag Manager and Google
 * Analytics are not loaded at all until the visitor accepts; essential cookies (the sign-in
 * session) are unaffected. The choice lives in this browser and can be changed from
 * "Cookie settings".
 *
 * Google Analytics 4 is configured here, not inside the Tag Manager container. Adding a GA4 tag
 * for the same measurement ID in Tag Manager would count every visit twice.
 */
export type AnalyticsConsent = "granted" | "denied";

export const GTM_ID = "GTM-P4Z2QFPV";
export const GA_MEASUREMENT_ID = "G-D5K9DSSFW2";
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

type AnalyticsWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };

function dataLayer(): unknown[] {
  return ((window as AnalyticsWindow).dataLayer ??= []);
}

/** Idempotent: inserts the Tag Manager script once per page. */
export function loadTagManager(): void {
  if (document.querySelector(`script[data-gtm="${GTM_ID}"]`)) return;
  const layer = dataLayer();
  layer.push({ "gtm.start": Date.now(), event: "gtm.js" });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`;
  script.dataset.gtm = GTM_ID;
  document.head.appendChild(script);
}

/**
 * Idempotent: loads Google Analytics 4 once per page. Page views after client-side navigation
 * are recorded by GA4's enhanced measurement ("page changes based on browser history events"),
 * which is on by default for web data streams.
 */
export function loadGoogleAnalytics(): void {
  if (document.querySelector(`script[data-ga="${GA_MEASUREMENT_ID}"]`)) return;
  const layer = dataLayer();
  // gtag.js reads the arguments object itself, so this must not be an arrow function or array.
  (window as AnalyticsWindow).gtag = function gtag() {
    layer.push(arguments);
  };
  const gtag = (window as AnalyticsWindow).gtag!;
  gtag("js", new Date());
  gtag("config", GA_MEASUREMENT_ID);
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  script.dataset.ga = GA_MEASUREMENT_ID;
  document.head.appendChild(script);
}

/** Loads every analytics tool. Call only once the visitor has granted consent. */
export function loadAnalytics(): void {
  loadGoogleAnalytics();
  loadTagManager();
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
  if (value === "granted") loadAnalytics();
  else clearAnalyticsCookies();
}

export function startAnalyticsIfConsented(): void {
  if (readAnalyticsConsent() === "granted") loadAnalytics();
}

export function openCookieSettings(): void {
  window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT));
}
