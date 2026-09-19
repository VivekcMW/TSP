import { z } from "zod";
import { INDUSTRY_SLUGS } from "@shared/schema";
import { normalizeKeywords, weightedKeywordSchema, type WeightedKeyword } from "@shared/profile-preferences";
import { publicationCandidateSchema, type PublicationCandidate } from "@shared/publication-preferences";
import { parsePublicationCandidate } from "./publication-candidates";

export interface OnboardingData {
  focusDescription: string;
  publications: string[];
  publicationCandidates?: PublicationCandidate[];
  keywords: WeightedKeyword[];
  influencers: string[];
  companies: string[];
  recommendedIndustry?: string;
}

/** A malformed URL must not discard a valid name or a valid sibling candidate. */
export function normalizeOnboardingPublications(names: unknown, candidates: unknown) {
  const items = Array.isArray(candidates) ? candidates : [];
  const candidateNames = items.map(item => publicationCandidateSchema.pick({ name: true }).safeParse(item))
    .flatMap(parsed => parsed.success ? [parsed.data.name] : []);
  const publications = new Map<string, string>();
  for (const value of [...(Array.isArray(names) ? names : []), ...candidateNames]) {
    const parsed = publicationCandidateSchema.shape.name.safeParse(value);
    if (!parsed.success) continue;
    const key = parsed.data.toLowerCase();
    if (!publications.has(key)) publications.set(key, parsed.data);
    if (publications.size === 20) break;
  }
  const metadata = new Map<string, PublicationCandidate>();
  for (const item of items) {
    const parsed = parsePublicationCandidate(item);
    if (!parsed) continue;
    const key = parsed.name.toLowerCase();
    const name = publications.get(key);
    if (name && !metadata.has(key)) metadata.set(key, { name, url: parsed.url });
  }
  return { publications: [...publications.values()], publicationCandidates: [...metadata.values()] };
}

/** AI output is untrusted: discard invalid entries, not their valid siblings.
 * This client-side suggestion cap does not relax server request validation. */
export function normalizeOnboardingKeywords(value: unknown): WeightedKeyword[] {
  if (!Array.isArray(value)) return [];
  const choices = new Map<string, WeightedKeyword>();
  for (const item of value) {
    const parsed = weightedKeywordSchema.safeParse(typeof item === "string" ? { keyword: item } : item);
    if (!parsed.success) continue;
    const key = parsed.data.keyword.toLowerCase();
    if (!choices.has(key)) choices.set(key, parsed.data);
    if (choices.size === 20) break;
  }
  return normalizeKeywords([...choices.values()]);
}

/** Validate the envelope before applying any suggestions to the current draft. */
export function normalizeOnboardingRecommendations(value: unknown): Omit<OnboardingData, "focusDescription"> {
  const data = z.record(z.unknown()).parse(value);
  const engine = z.object({ industry: z.enum(INDUSTRY_SLUGS) }).safeParse(data.recommendedEngine);
  const { publications, publicationCandidates } = normalizeOnboardingPublications(data.publications, data.publicationCandidates);
  return {
    publications,
    ...(publicationCandidates.length ? { publicationCandidates } : {}),
    keywords: normalizeOnboardingKeywords(data.keywords),
    influencers: normalizeOnboardingChoices(data.personalities),
    companies: normalizeOnboardingChoices(data.companies),
    recommendedIndustry: engine.success ? engine.data.industry : undefined,
  };
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

/** Selected AI/custom choices must be rendered even outside the static catalog. */
export function visibleOnboardingChoices(catalog: string[], selected: string[]): string[] {
  const choices = new Map<string, string>();
  for (const item of [...selected, ...catalog]) {
    if (!choices.has(item.toLocaleLowerCase())) choices.set(item.toLocaleLowerCase(), item);
  }
  return [...choices.values()];
}