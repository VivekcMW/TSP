import type { WeightedKeyword } from "@shared/profile-preferences";
import type { PublicationCandidate } from "@shared/publication-preferences";

export interface OnboardingData {
  focusDescription: string;
  publications: string[];
  publicationCandidates?: PublicationCandidate[];
  keywords: WeightedKeyword[];
  influencers: string[];
  companies: string[];
  recommendedIndustry?: string;
}

/** Match the server's 20-item limit without selecting hidden defaults. */
export function normalizeOnboardingChoices(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const choices = new Map<string, string>();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) continue;
    const trimmed = item.trim().slice(0, 100);
    if (!choices.has(trimmed.toLocaleLowerCase())) choices.set(trimmed.toLocaleLowerCase(), trimmed);
  }
  return [...choices.values()].slice(0, 20);
}
