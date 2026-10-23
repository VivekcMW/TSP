import { describe, expect, it } from "vitest";
import { COUNTRIES, currencyForCountry, guessCountry, readSavedCountry, resolvePricingCountry, saveCountry } from "./pricing-country";

const memory = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
};

describe("the country prices are shown for", () => {
  it("prices India in rupees and every other country in US dollars", () => {
    expect(currencyForCountry("India")).toBe("INR");
    for (const country of ["United States", "United Kingdom", "Germany", "Singapore", "United Arab Emirates"]) expect(currencyForCountry(country)).toBe("USD");
  });

  it.each([
    [{ timeZone: "Asia/Kolkata", locales: ["en-US"] }, "India"],
    [{ timeZone: "Asia/Calcutta" }, "India"],
    [{ timeZone: "Europe/London", locales: ["en-IN"] }, "India"],
    [{ timeZone: "Europe/London", locales: ["en-GB"] }, "United Kingdom"],
    [{ timeZone: "Europe/Berlin", locales: ["de-DE", "en"] }, "Germany"],
    [{ timeZone: "Europe/Prague", locales: ["cs-CZ"] }, "Czech Republic"],
    [{ timeZone: "Asia/Tokyo", locales: ["ja"] }, "United States"],
    [{}, "United States"],
  ])("guesses %j as %s", (env, country) => expect(guessCountry(env)).toBe(country));

  it("prefers the visitor's own choice, then their registration country, then the guess", () => {
    expect(resolvePricingCountry({ saved: "Germany", registered: "India", guessed: "United States" })).toBe("Germany");
    expect(resolvePricingCountry({ saved: null, registered: "India", guessed: "United States" })).toBe("India");
    expect(resolvePricingCountry({ saved: null, registered: "Atlantis", guessed: "Japan" })).toBe("Japan");
  });

  it("remembers a choice, ignores unknown values, and carries on when storage is blocked", () => {
    const store = memory();
    saveCountry("Singapore", store);
    expect(readSavedCountry(store)).toBe("Singapore");
    store.setItem("tsp:pricing-country", "Narnia");
    expect(readSavedCountry(store)).toBeNull();
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(() => saveCountry("India", blocked)).not.toThrow();
    expect(readSavedCountry(blocked)).toBeNull();
    expect(COUNTRIES).toContain("India");
    expect(new Set(COUNTRIES).size).toBe(COUNTRIES.length);
  });
});
