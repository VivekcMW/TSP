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

/**
 * Query parameters that must never reach Google Analytics: one-time tokens from reset,
 * verification, invite and preference links, OAuth hand-offs, and user-written draft text.
 * `returnTo` is cleaned recursively because sign-in redirects embed the original URL in it.
 */
const SENSITIVE_PARAMS = new Set(["token", "code", "state", "email", "text", "draft"]);

function stripSensitiveParams(params: URLSearchParams): void {
  for (const key of [...params.keys()]) if (SENSITIVE_PARAMS.has(key)) params.delete(key);
  const returnTo = params.get("returnTo");
  if (!returnTo) return;
  const [path, query] = returnTo.split("?", 2);
  if (!query) return;
  const inner = new URLSearchParams(query);
  stripSensitiveParams(inner);
  const cleaned = inner.toString();
  params.set("returnTo", cleaned ? `${path}?${cleaned}` : path);
}

/** The URL as it may be sent to analytics: absolute, with sensitive query parameters removed. */
export function sanitizeUrl(value: string): string {
  if (!value) return "";
  let url: URL;
  try { url = new URL(value); } catch { return ""; }
  stripSensitiveParams(url.searchParams);
  return url.toString();
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
 * Idempotent: loads Google Analytics 4 once per page.
 *
 * The app sends page views itself (`send_page_view: false`) so that the URL can be
 * sanitised and the title is the one visitors see, not the prerendered one. GA4's own
 * "page changes based on browser history events" measurement must therefore be OFF in the
 * data stream settings, or client-side navigations would count twice.
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
  gtag("config", GA_MEASUREMENT_ID, { send_page_view: false });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  script.dataset.ga = GA_MEASUREMENT_ID;
  document.head.appendChild(script);
  schedulePageView();
}

function isAnalyticsActive(): boolean {
  return readAnalyticsConsent() === "granted" && typeof (window as AnalyticsWindow).gtag === "function";
}

type EventValue = string | number | boolean | undefined;
export type EventParams = Record<string, EventValue | Array<Record<string, EventValue>>>;

const containsEmail = (value: unknown): boolean => typeof value === "string" ? /\S+@\S+\.\S+/.test(value)
  : Array.isArray(value) ? value.some(containsEmail)
  : value !== null && typeof value === "object" ? Object.values(value).some(containsEmail) : false;

/**
 * Records a product event. Silently does nothing without consent. Parameters must describe
 * the action (platform, plan, method), never the person: an event carrying an email
 * address anywhere in it is dropped rather than sent.
 */
export function track(name: string, params: EventParams = {}): void {
  if (!isAnalyticsActive()) return;
  if (containsEmail(params)) {
    // A programming error, not a runtime condition: surface it instead of failing silently.
    console.warn(`[analytics] dropped "${name}": parameters must not contain an email address`);
    return;
  }
  (window as AnalyticsWindow).gtag!("event", name, params);
}

let lastPageLocation: string | null = null;

/** Sends a page_view for the current URL and title, with sensitive query parameters removed. */
export function trackPageView(): void {
  if (!isAnalyticsActive()) return;
  const pageLocation = sanitizeUrl(window.location.href);
  const referrer = lastPageLocation ?? sanitizeUrl(document.referrer);
  const params: Record<string, string> = { page_location: pageLocation, page_title: document.title };
  if (referrer) params.page_referrer = referrer;
  (window as AnalyticsWindow).gtag!("event", "page_view", params);
  lastPageLocation = pageLocation;
}

/**
 * Sends the page view once the document title has caught up with the route. react-helmet-async
 * applies head changes in an animation frame, so waiting two frames plus a task is enough.
 */
export function schedulePageView(): void {
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(trackPageView, 0)));
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
