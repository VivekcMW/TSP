import { z } from "zod";

/** Saved provider editions, not arbitrary locales or query translation targets. */
export const searchEditionSchema = z.enum([
  "en-US", "en-GB", "en-IN", "hi-IN", "fr-FR", "de-DE", "es-ES", "pt-BR", "ja-JP", "en-AU", "en-CA",
]);

export type SearchEditionId = z.infer<typeof searchEditionSchema>;
export interface SearchEdition {
  id: SearchEditionId;
  hl: string;
  gl: string;
  ceid: string;
}

const editions: Record<SearchEditionId, { label: string } & Omit<SearchEdition, "id">> = {
  "en-US": { label: "English (United States)", hl: "en-US", gl: "US", ceid: "US:en" },
  "en-GB": { label: "English (United Kingdom)", hl: "en-GB", gl: "GB", ceid: "GB:en" },
  "en-IN": { label: "English (India)", hl: "en-IN", gl: "IN", ceid: "IN:en" },
  "hi-IN": { label: "Hindi (India)", hl: "hi", gl: "IN", ceid: "IN:hi" },
  "fr-FR": { label: "French (France)", hl: "fr", gl: "FR", ceid: "FR:fr" },
  "de-DE": { label: "German (Germany)", hl: "de", gl: "DE", ceid: "DE:de" },
  "es-ES": { label: "Spanish (Spain)", hl: "es", gl: "ES", ceid: "ES:es" },
  // Google's Brazil edition uses pt-419 in its provider parameters.
  "pt-BR": { label: "Portuguese (Brazil)", hl: "pt-419", gl: "BR", ceid: "BR:pt-419" },
  "ja-JP": { label: "Japanese (Japan)", hl: "ja", gl: "JP", ceid: "JP:ja" },
  "en-AU": { label: "English (Australia)", hl: "en-AU", gl: "AU", ceid: "AU:en" },
  "en-CA": { label: "English (Canada)", hl: "en-CA", gl: "CA", ceid: "CA:en" },
};

export const SEARCH_EDITIONS = searchEditionSchema.options.map(value => ({ value, label: editions[value].label }));

/** Deterministic read fallback for missing/unsupported stored values. Writes use the strict schema.
 * These are provider edition parameters only: no strict language/location filtering or translation.
 */
export function getSearchEdition(value?: unknown): SearchEdition {
  const parsed = searchEditionSchema.safeParse(value);
  const id = parsed.success ? parsed.data : "en-US";
  const { hl, gl, ceid } = editions[id];
  return { id, hl, gl, ceid };
}