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
const GA_DISABLED_KEY = `ga-disable-${GA_MEASUREMENT_ID}` as const;
let consentForPage: AnalyticsConsent | null = null;

export function readAnalyticsConsent(): AnalyticsConsent | null {
  if (consentForPage !== null) return consentForPage;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

const ANALYTICS_PARAMS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id", "gclid", "dclid", "gbraid", "wbraid", "tab", "view"]);

/** The URL as it may be sent to analytics: absolute, with sensitive query parameters removed. */
export function sanitizeUrl(value: string): string {
  if (!value) return "";
  let url: URL;
  try { url = new URL(value); } catch { return ""; }
  if (!["https:", "http:"].includes(url.protocol)) return "";
  url.username = "";
  url.password = "";
  url.hash = "";
  for (const [key, value] of [...url.searchParams]) {
    if (!ANALYTICS_PARAMS.has(key) || !/^[\w .~-]{1,200}$/.test(value)) url.searchParams.delete(key);
  }
  return url.toString();
}

type AnalyticsWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void; [GA_DISABLED_KEY]?: boolean };

function dataLayer(): unknown[] {
  return ((window as AnalyticsWindow).dataLayer ??= []);
}

/** Idempotent: inserts the Tag Manager script once per page. */
export function loadTagManager(): void {
  if (readAnalyticsConsent() !== "granted") return;
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
  if (readAnalyticsConsent() !== "granted") return;
  if (document.querySelector(`script[data-ga="${GA_MEASUREMENT_ID}"]`)) return;
  const layer = dataLayer();
  // gtag.js reads the arguments object itself, so this must not be an arrow function or array.
  (window as AnalyticsWindow).gtag = function gtag() {
    layer.push(arguments);
  };
  const gtag = (window as AnalyticsWindow).gtag!;
  gtag("consent", "default", consentSettings("granted"));
  gtag("js", new Date());
  // page_location at config level covers GA's automatic events (scroll, session_start,
  // form_start…), which otherwise carry the raw URL regardless of what page_view says.
  gtag("config", GA_MEASUREMENT_ID, {
    send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
    ...pageParams(), page_title: currentPageTitle(),
  });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  script.dataset.ga = GA_MEASUREMENT_ID;
  document.head.appendChild(script);
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
  (window as AnalyticsWindow).gtag!("event", name, { ...params, ...pageParams(), page_title: currentPageTitle() });
}

let lastPageLocation: string | null = null;
let navigationKey: string | null = null;
let readyKey: string | null = null;
let sentKey: string | null = null;
let navigationReferrer: string | null = null;

/** The sanitised location and referrer of the current page (referrer omitted when empty). */
function pageParams(): Record<string, string> {
  const referrer = navigationReferrer ?? sanitizeUrl(document.referrer);
  return { page_location: sanitizeUrl(window.location.href), page_referrer: referrer };
}

// Fixed text, so these never echo anything a visitor typed.
const AUTH_PAGE_TITLES: ReadonlyArray<readonly [string, string]> = [["/sign-in", "Sign in | TheSocialPundit"], ["/sign-up", "Sign up | TheSocialPundit"]];

/** Only a public page (its own canonical) reports its title; private pages could name a draft or a person. */
export function analyticsPageTitle(pathname: string, title: string, canonicalPathname: string | undefined): string {
  const path = pathname.replace(/\/$/, "");
  if (canonicalPathname !== undefined && canonicalPathname.replace(/\/$/, "") === path) return title;
  const auth = AUTH_PAGE_TITLES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  if (auth) return auth[1];
  return path.startsWith("/dashboard") ? "Workspace | TheSocialPundit" : "TheSocialPundit";
}

function currentPageTitle(): string {
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  return analyticsPageTitle(window.location.pathname, document.title, canonical ? new URL(canonical).pathname : undefined);
}

/** Sends a page_view for the current URL and title, with sensitive query parameters removed. */
export function trackPageView(): void {
  if (!isAnalyticsActive() || readyKey !== navigationKey || readyKey === null || sentKey === readyKey) return;
  const params: Record<string, string> = { ...pageParams(), page_title: currentPageTitle() };
  const gtag = (window as AnalyticsWindow).gtag!;
  gtag("set", params); // every later event (scroll, form_start, custom) reports this page
  gtag("config", GA_MEASUREMENT_ID, { send_page_view: false, ...params });
  gtag("event", "page_view", params);
  lastPageLocation = params.page_location;
  sentKey = readyKey;
}

export function beginAnalyticsNavigation(): void {
  const key = sanitizeUrl(window.location.href);
  if (navigationKey === key) return;
  navigationReferrer = lastPageLocation ?? sanitizeUrl(document.referrer);
  navigationKey = key;
  readyKey = null;
  sentKey = null;
  if (isAnalyticsActive()) {
    const params = { ...pageParams(), page_title: currentPageTitle() };
    (window as AnalyticsWindow).gtag!("set", params);
    (window as AnalyticsWindow).gtag!("config", GA_MEASUREMENT_ID, { send_page_view: false, ...params });
  }
}

/** Called inside the route's Suspense boundary, after its content and metadata commit. */
export function completeAnalyticsNavigation(pathname: string): void {
  if (pathname.replace(/\/$/, "") !== window.location.pathname.replace(/\/$/, "")) return;
  beginAnalyticsNavigation();
  readyKey = navigationKey;
  trackPageView();
}

function consentSettings(value: AnalyticsConsent) {
  return { analytics_storage: value, ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" };
}

/** Loads every analytics tool. Call only once the visitor has granted consent. */
export function loadAnalytics(): void {
  if (readAnalyticsConsent() !== "granted") return;
  (window as AnalyticsWindow)[GA_DISABLED_KEY] = false;
  loadGoogleAnalytics();
  (window as AnalyticsWindow).gtag?.("consent", "update", consentSettings("granted"));
  loadTagManager();
  trackPageView();
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
  consentForPage = value;
  try { window.localStorage.setItem(STORAGE_KEY, value); }
  catch { console.warn("[analytics] consent could not be saved; applying it to this page only"); }
  if (value === "granted") loadAnalytics();
  else disableAnalytics();
}

function disableAnalytics(): void {
  (window as AnalyticsWindow)[GA_DISABLED_KEY] = true;
  (window as AnalyticsWindow).gtag?.("consent", "update", consentSettings("denied"));
  sentKey = null;
  lastPageLocation = null;
  clearAnalyticsCookies();
}

let watchingConsent = false;
export function startAnalyticsIfConsented(): void {
  if (!watchingConsent) {
    watchingConsent = true;
    window.addEventListener("storage", event => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      consentForPage = null;
      if (readAnalyticsConsent() === "granted") loadAnalytics();
      else disableAnalytics();
    });
  }
  if (readAnalyticsConsent() === "granted") loadAnalytics();
}

export function openCookieSettings(): void {
  window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT));
}
