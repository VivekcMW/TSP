/** Countries offered at registration and on the pricing page. */
export const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Argentina", "Armenia", "Australia", 
  "Austria", "Azerbaijan", "Bahrain", "Bangladesh", "Belarus", "Belgium", "Bhutan", "Bolivia", 
  "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Cambodia", "Cameroon", 
  "Canada", "Chile", "China", "Colombia", "Costa Rica", "Croatia", "Cyprus", "Czech Republic", 
  "Denmark", "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "Estonia", "Ethiopia", 
  "Finland", "France", "Georgia", "Germany", "Ghana", "Greece", "Guatemala", "Honduras", 
  "Hong Kong", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", 
  "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kuwait", "Latvia", "Lebanon", 
  "Lithuania", "Luxembourg", "Malaysia", "Maldives", "Malta", "Mauritius", "Mexico", "Moldova", 
  "Monaco", "Mongolia", "Montenegro", "Morocco", "Myanmar", "Nepal", "Netherlands", "New Zealand", 
  "Nigeria", "North Macedonia", "Norway", "Oman", "Pakistan", "Panama", "Paraguay", "Peru", 
  "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda", "Saudi Arabia", 
  "Senegal", "Serbia", "Singapore", "Slovakia", "Slovenia", "South Africa", "South Korea", "Spain", 
  "Sri Lanka", "Sweden", "Switzerland", "Taiwan", "Tanzania", "Thailand", "Tunisia", "Turkey", 
  "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay", 
  "Uzbekistan", "Venezuela", "Vietnam", "Zambia", "Zimbabwe"
];

export type PricingCurrency = "INR" | "USD";

/** Rupees for India; US dollars for every other country (the only two currencies in the catalog). */
export function currencyForCountry(country: string): PricingCurrency {
  return country === "India" ? "INR" : "USD";
}

const INDIA_TIME_ZONES = new Set(["Asia/Kolkata", "Asia/Calcutta"]);
// Where the browser's English region name differs from our country list.
const REGION_ALIASES: Record<string, string> = { Czechia: "Czech Republic", "Türkiye": "Turkey", "Hong Kong SAR China": "Hong Kong", "Myanmar (Burma)": "Myanmar" };
export const FALLBACK_COUNTRY = "United States";

/** A first guess from the browser: India by time zone, otherwise the region in the visitor's languages. */
export function guessCountry(env: { timeZone?: string; locales?: readonly string[] }): string {
  if (env.timeZone && INDIA_TIME_ZONES.has(env.timeZone)) return "India";
  let names: Intl.DisplayNames | undefined;
  try { names = new Intl.DisplayNames(["en"], { type: "region" }); } catch { return FALLBACK_COUNTRY; }
  for (const locale of env.locales ?? []) {
    let region: string | undefined;
    try { region = new Intl.Locale(locale).region; } catch { continue; }
    if (!region) continue;
    const name = names.of(region);
    const country = name ? REGION_ALIASES[name] ?? name : undefined;
    if (country && COUNTRIES.includes(country)) return country;
  }
  return FALLBACK_COUNTRY;
}

/** The visitor's own choice wins, then the country they registered with, then the browser's guess. */
export function resolvePricingCountry({ saved, registered, guessed }: { saved: string | null; registered?: string | null; guessed: string }): string {
  if (saved && COUNTRIES.includes(saved)) return saved;
  if (registered && COUNTRIES.includes(registered)) return registered;
  return guessed;
}

type Store = Pick<Storage, "getItem" | "setItem">;
export const PRICING_COUNTRY_KEY = "tsp:pricing-country";
function browserStore(): Store | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}

export function readSavedCountry(store: Store | undefined = browserStore()): string | null {
  try {
    const value = store?.getItem(PRICING_COUNTRY_KEY) ?? null;
    return value && COUNTRIES.includes(value) ? value : null;
  } catch { return null; }
}

export function saveCountry(country: string, store: Store | undefined = browserStore()) {
  try { store?.setItem(PRICING_COUNTRY_KEY, country); } catch { /* storage blocked: the choice lasts for this visit */ }
}
