import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useIsSignedIn } from "@/lib/dev-auth";
import { FALLBACK_COUNTRY, PRICING_COUNTRY_KEY, guessCountry, readSavedCountry, resolvePricingCountry, saveCountry } from "@/lib/pricing-country";

function browserGuess() {
  if (typeof window === "undefined") return FALLBACK_COUNTRY;
  return guessCountry({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, locales: navigator.languages });
}

/** The pricing country, shared by the public pricing page and in-app billing. */
export function usePricingCountry(): [string, (country: string) => void] {
  const isSignedIn = useIsSignedIn();
  const { data: me } = useQuery<{ country?: string | null }>({ queryKey: ["/api/me"], enabled: isSignedIn });
  const [saved, setSaved] = useState(readSavedCountry);
  const [guessed] = useState(browserGuess);
  const country = resolvePricingCountry({ saved, registered: me?.country, guessed });
  // Another tab changing the choice keeps this one in step.
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === PRICING_COUNTRY_KEY) setSaved(readSavedCountry()); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const choose = (next: string) => { saveCountry(next); setSaved(next); };
  return [country, choose];
}
