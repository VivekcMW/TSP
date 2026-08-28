/**
 * Emits client/src/design/tokens.generated.css from tokens.ts.
 *
 * tokens.ts is the only file to edit. Run `npm run design:tokens` after
 * changing it; `npm run design:check` fails if the committed CSS has drifted,
 * so the two can never disagree silently.
 */
import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";
import {
  invariant,
  lightColors,
  darkColors,
  lightEffects,
  darkEffects,
  derivedBorderTokens,
} from "../client/src/design/tokens";

const OUT = resolve(import.meta.dirname, "../client/src/design/tokens.generated.css");

const decls = (obj: Record<string, string>) =>
  Object.entries(obj)
    .map(([k, v]) => `  --${k}: ${v};`)
    .join("\n");

/**
 * A token's border colour, derived from its own fill by shifting lightness.
 * The first declaration is a flat fallback for browsers without relative
 * colour syntax; the second overrides it where supported.
 */
const derived = () =>
  derivedBorderTokens
    .map(
      (t) => `
  /* Fallback for browsers without relative colour syntax */
  --${t}-border: hsl(var(--${t}));
  --${t}-border: hsl(from hsl(var(--${t})) h s calc(l + var(--opaque-button-border-intensity)) / alpha);`,
    )
    .join("\n");

const css = `/*
 * GENERATED FILE — DO NOT EDIT.
 * Source: client/src/design/tokens.ts
 * Regenerate: npm run design:tokens
 */

:root {
${decls(invariant)}
${decls(lightColors)}
${decls(lightEffects)}
${derived()}
}

.dark {
${decls(darkColors)}
${decls(darkEffects)}
${derived()}
}
`;

const check = process.argv.includes("--check");
if (check) {
  if (!existsSync(OUT)) {
    console.error("design:check FAILED — tokens.generated.css is missing. Run: npm run design:tokens");
    process.exit(1);
  }
  if (readFileSync(OUT, "utf8") !== css) {
    console.error("design:check FAILED — tokens.generated.css is out of date. Run: npm run design:tokens");
    process.exit(1);
  }
  console.log("design:check passed — generated CSS matches tokens.ts");
} else {
  writeFileSync(OUT, css);
  const count =
    Object.keys(invariant).length +
    Object.keys(lightColors).length +
    Object.keys(lightEffects).length;
  console.log(`wrote tokens.generated.css — ${count} light tokens, ${Object.keys(darkColors).length + Object.keys(darkEffects).length} dark, ${derivedBorderTokens.length} derived`);
}
