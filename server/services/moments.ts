import { MOMENT_TAG_ALL, isoDateSchema, type MomentRegion, type MomentView } from "@shared/moments";

/** The moment fields matching and views need; repository rows satisfy it. */
export interface MomentRecord {
  id: string;
  title: string;
  startsOn: string;
  endsOn: string | null;
  region: string;
  tags: string[];
  leadDays: number;
  url: string | null;
  description: string | null;
}

/** The profile signals moments are matched on. Every field may be missing on legacy rows. */
export interface MomentProfile {
  keywords?: Array<{ keyword: string; weight: number }> | null;
  companies?: string[] | null;
  recommendedIndustry?: string | null;
  searchEdition?: string | null;
}

export const DEFAULT_WINDOW_DAYS = 60;
export const MAX_WINDOW_DAYS = 120;
const DAY_MS = 86_400_000;

const EDITION_REGIONS: Record<string, MomentRegion> = {
  "en-US": "US", "en-GB": "UK", "en-IN": "IN", "hi-IN": "IN", "fr-FR": "EU", "de-DE": "EU", "es-ES": "EU",
  "pt-BR": "BR", "ja-JP": "JP", "en-AU": "AU", "en-CA": "CA",
};

/** Plain audience phrases for the suggested angle, by recommended industry slug. */
const INDUSTRY_AUDIENCES: Record<string, string> = {
  media_advertising: "advertisers and agencies", product_marketing: "product marketers", technology_saas: "tech teams",
  finance_banking: "finance teams", healthcare_pharma: "healthcare teams", ecommerce_retail: "retailers",
  real_estate: "real estate teams", education_edtech: "educators", manufacturing: "manufacturers",
  energy_sustainability: "energy and sustainability teams", legal_services: "legal teams", nonprofit_ngo: "nonprofits",
  government_public: "public sector teams", hospitality_travel: "hospitality and travel teams",
  entertainment_media: "media and entertainment teams", telecommunications: "telecom teams", agriculture: "food and farming businesses",
};
/**
 * What each recommended industry slug means as tag phrases. A tag matches only when it contains a whole phrase,
 * so "real_estate" never matches "real time marketing" and "government_public" never matches "public relations".
 */
const INDUSTRY_PHRASES: Record<string, string[]> = {
  media_advertising: ["advertising", "adtech", "ad tech", "media buying", "programmatic"],
  product_marketing: ["product marketing", "go to market", "product launch"],
  technology_saas: ["saas", "software", "cloud computing"],
  finance_banking: ["finance", "banking", "fintech", "financial services", "payments"],
  healthcare_pharma: ["healthcare", "health care", "pharma", "pharmaceutical", "life sciences", "biotech"],
  consulting_services: ["consulting", "professional services"],
  ecommerce_retail: ["ecommerce", "e commerce", "retail"],
  real_estate: ["real estate", "proptech", "housing"],
  education_edtech: ["education", "edtech"],
  manufacturing: ["manufacturing", "industrial"],
  energy_sustainability: ["energy", "sustainability", "climate", "renewables"],
  legal_services: ["legal", "legaltech"],
  nonprofit_ngo: ["nonprofit", "non profit", "ngo", "charity"],
  government_public: ["government", "public sector", "public policy"],
  hospitality_travel: ["hospitality", "travel", "tourism"],
  entertainment_media: ["entertainment", "streaming"],
  telecommunications: ["telecom", "telecommunications"],
  agriculture: ["agriculture", "agritech", "farming"],
};

export function regionForEdition(edition: string | null | undefined): MomentRegion | null {
  return edition ? EDITION_REGIONS[edition] ?? null : null;
}

/** Lowercase letter/number words; underscores and punctuation separate words. */
export function words(value: string): string[] {
  return value.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function containsSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (!needle.length || needle.length > haystack.length) return false;
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((word, index) => haystack[start + index] === word)) return true;
  }
  return false;
}

export interface ProfileTerms {
  /** Positive keywords and companies: matched in either direction. */
  terms: string[][];
  /** The recommended industry's phrases: the tag must contain a whole phrase. */
  industry: string[][];
}

export function profileTerms(profile: MomentProfile | null | undefined): ProfileTerms {
  if (!profile) return { terms: [], industry: [] };
  const keywords = (profile.keywords ?? []).filter(item => item?.keyword && item.weight > 0).map(item => words(item.keyword));
  const companies = (profile.companies ?? []).filter(Boolean).map(words);
  const industry = (profile.recommendedIndustry ? INDUSTRY_PHRASES[profile.recommendedIndustry] ?? [] : []).map(words);
  return { terms: [...keywords, ...companies].filter(term => term.length > 0), industry: industry.filter(phrase => phrase.length > 0) };
}

/** Whole words in order: the tag inside a keyword/company (or the reverse), or a whole industry phrase inside the tag. */
export function tagMatches(tag: string, { terms, industry }: ProfileTerms): boolean {
  const tagWords = words(tag);
  return tagWords.length > 0 && (terms.some(term => containsSequence(term, tagWords) || containsSequence(tagWords, term))
    || industry.some(phrase => containsSequence(tagWords, phrase)));
}

export function momentMatchesProfile(moment: Pick<MomentRecord, "region" | "tags">, profile: MomentProfile | null | undefined): boolean {
  if (moment.region !== "global" && moment.region !== regionForEdition(profile?.searchEdition)) return false;
  const tags = moment.tags.map(tag => tag.toLocaleLowerCase());
  if (tags.includes(MOMENT_TAG_ALL)) return true;
  const terms = profileTerms(profile);
  return tags.some(tag => tagMatches(tag, terms));
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Calendar date in an IANA time zone; UTC when the zone is unknown. */
export function todayIn(timezone: string | null | undefined, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export const lastDay = (moment: Pick<MomentRecord, "startsOn" | "endsOn">) => moment.endsOn ?? moment.startsOn;
export const leadWindowStart = (moment: Pick<MomentRecord, "startsOn" | "leadDays">) => addDays(moment.startsOn, -moment.leadDays);

/** From `leadDays` before the start until the moment ends. */
export function isInLeadWindow(moment: Pick<MomentRecord, "startsOn" | "endsOn" | "leadDays">, today: string): boolean {
  return leadWindowStart(moment) <= today && today <= lastDay(moment);
}

export function overlapsWindow(moment: Pick<MomentRecord, "startsOn" | "endsOn">, from: string, to: string): boolean {
  return moment.startsOn <= to && lastDay(moment) >= from;
}

/** Monday plan: the lead window opens this week, or the moment itself starts this week. */
export function entersLeadWindowDuring(moment: Pick<MomentRecord, "startsOn" | "leadDays">, weekStart: string, weekEnd: string): boolean {
  const opens = leadWindowStart(moment);
  return (opens >= weekStart && opens <= weekEnd) || (moment.startsOn >= weekStart && moment.startsOn <= weekEnd);
}

export function suggestedAngle(title: string, profile: MomentProfile | null | undefined): string {
  const audience = profile?.recommendedIndustry ? INDUSTRY_AUDIENCES[profile.recommendedIndustry] : undefined;
  return `What ${title.trim()} means for ${audience ?? "your clients"}`;
}

export function momentCategory(tags: readonly string[]): string {
  return tags.find(tag => tag.toLocaleLowerCase() !== MOMENT_TAG_ALL) ?? "general";
}

export function toMomentView(moment: MomentRecord, profile: MomentProfile | null | undefined, today: string): MomentView {
  return {
    id: moment.id, title: moment.title, date: moment.startsOn, endDate: moment.endsOn, leadDays: moment.leadDays,
    category: momentCategory(moment.tags), url: moment.url, description: moment.description,
    suggestedAngle: suggestedAngle(moment.title, profile), inLeadWindow: isInLeadWindow(moment, today),
  };
}

/** Moments overlapping [from, to] that match the person, by date then title. */
export function momentsForProfile(moments: readonly MomentRecord[], profile: MomentProfile | null | undefined,
  window: { from: string; to: string; today: string }): MomentView[] {
  return moments
    .filter(moment => overlapsWindow(moment, window.from, window.to) && momentMatchesProfile(moment, profile))
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
    .map(moment => toMomentView(moment, profile, window.today));
}

/** `from`/`to` query: defaults to today..+60 days, at most 120 days long. Undefined when invalid. */
export function parseMomentWindow(query: { from?: unknown; to?: unknown }, today: string): { from: string; to: string } | undefined {
  const read = (value: unknown) => value === undefined ? null : isoDateSchema.safeParse(value).success ? value as string : undefined;
  const from = read(query.from), to = read(query.to);
  if (from === undefined || to === undefined) return undefined;
  const start = from ?? today;
  const end = to ?? addDays(start, DEFAULT_WINDOW_DAYS);
  const span = daysBetween(start, end);
  return span >= 0 && span <= MAX_WINDOW_DAYS ? { from: start, to: end } : undefined;
}
