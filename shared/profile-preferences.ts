import { z } from "zod";

export type WeightedKeyword = {
  keyword: string;
  weight: number;
  category?: string;
};

export type KeywordInput = string | {
  keyword: string;
  weight?: number;
  category?: WeightedKeyword["category"];
};

const profileValueSchema = z.string().trim().min(1).max(100);

export const weightedKeywordSchema = z.object({
  keyword: profileValueSchema,
  weight: z.number().finite().min(0).max(1).default(0.7),
  // Existing AI suggestions use topical labels such as AI and Infrastructure.
  category: profileValueSchema.optional(),
});

const keywordInputSchema = z.union([profileValueSchema, weightedKeywordSchema]);

/** Validate every entry, trim and deduplicate; the first occurrence wins. Never mutate input. */
export function normalizeKeywords(input: readonly KeywordInput[]): WeightedKeyword[] {
  const unique = new Map<string, WeightedKeyword>();
  for (const entry of input) {
    const parsed = keywordInputSchema.parse(entry);
    const keyword = typeof parsed === "string" ? { keyword: parsed, weight: 0.7 } : parsed;
    const key = keyword.keyword.toLowerCase();
    if (!unique.has(key)) unique.set(key, keyword);
  }
  return [...unique.values()];
}

/** Retain selected order/spelling and previous metadata, matching independently of case/spacing. */
export function reconcileKeywords(selected: readonly string[], previous: readonly KeywordInput[]): WeightedKeyword[] {
  const metadata = new Map(normalizeKeywords(previous).map((keyword) => [keyword.keyword.toLowerCase(), keyword]));
  return normalizeKeywords(selected).map((keyword) => ({
    ...(metadata.get(keyword.keyword.toLowerCase()) ?? keyword),
    keyword: keyword.keyword,
  }));
}

// Apply request limits BEFORE normalization so over-limit payloads cannot be silently shortened.
export const profileKeywordsSchema = z.array(keywordInputSchema).max(20).transform(normalizeKeywords);

export const profileListSchema = z.array(profileValueSchema).max(20).transform((values) => {
  const unique = new Map<string, string>();
  for (const value of values) {
    if (!unique.has(value.toLowerCase())) unique.set(value.toLowerCase(), value);
  }
  return [...unique.values()];
});

export const focusDescriptionSchema = z.string().trim().min(10).max(500);

/** Existing profiles may clear their focus; completing onboarding may not. */
export const profileFocusDescriptionSchema = z.string().trim().pipe(z.union([z.literal(""), focusDescriptionSchema]));

export const timezoneSchema = z.string().trim().min(1).max(100).refine((timeZone) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}, "Invalid timezone");