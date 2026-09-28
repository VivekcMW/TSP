import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Public pages may only promise what the product does today.
const root = path.resolve(import.meta.dirname, "../../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const sources = (dir: string) => readdirSync(path.join(root, dir))
  .filter(name => /\.tsx?$/.test(name) && !name.includes(".test."))
  .map(name => `${dir}/${name}`);
const publicFiles = [
  ...["landing", "about", "how-it-works", "industries", "pricing", "resources", "contact"].map(page => `client/src/pages/${page}.tsx`),
  ...sources("client/src/components/landing"),
];

const staleClaims: [RegExp, string][] = [
  [/first 1,000/i, "free-for-1,000 promise, while paid plans are on sale"],
  [/80\+/, "a source count nobody measures"],
  [/hallucination/i, "a guarantee no AI product can give"],
  [/Social Inbox/, "the old name for Discover"],
  [/Gemini 2\.5/, "an AI model we no longer use"],
  [/by 2025/, "a date already in the past"],
];

describe("public page claims", () => {
  it.each(staleClaims)("never say %s (%s)", pattern => {
    const offenders = publicFiles.filter(file => pattern.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("tell people how the newsletter uses their email address", () => {
    const privacy = read("client/src/pages/privacy.tsx");
    expect(privacy).toMatch(/<h2[^>]*>Newsletter<\/h2>/);
    expect(privacy).toMatch(/confirm/i);
    expect(privacy).toMatch(/unsubscribe/i);
    expect(privacy).not.toContain("Last updated: September 3, 2026");
  });
});
