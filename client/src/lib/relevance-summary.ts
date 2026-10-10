import type { TextEvidence } from "@shared/article-quality";

interface RelevanceSource {
  relevanceReason?: string | null;
  matchedKeywords?: string[] | null;
  qualityMetadata?: { relevance?: { evidence?: Array<Pick<TextEvidence, "type" | "label">> } } | null;
}

const list = (labels: string[]) => {
  const shown = labels.slice(0, 3);
  const more = labels.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown[0];
};

/** Plain-language reason a story is in Discover, from its stored evidence (or older stored text). */
export function relevanceSummary(item: RelevanceSource): string | null {
  // A stored but empty reason means "no explanation": never infer one from tags.
  if (item.relevanceReason === "") return null;
  let matches = item.qualityMetadata?.relevance?.evidence?.map(({ type, label }) => ({ type, label })) ?? [];
  const reason = item.relevanceReason ?? "";
  if (!matches.length && reason) {
    matches = [...reason.matchAll(/\b(keyword|company|influencer|focus) "([^"]+)"/g)].map(([, type, label]) => ({ type: type as TextEvidence["type"], label }));
  }
  const of = (type: TextEvidence["type"]) => [...new Set(matches.filter(match => match.type === type).map(match => match.label))];
  const topics = [...of("keyword"), ...of("focus")];
  const companies = of("company");
  const people = of("influencer");
  const sentences: string[] = [];
  if (topics.length) sentences.push(`Matches your ${topics.length > 1 ? "topics" : "topic"} ${list(topics)}.`);
  if (companies.length) sentences.push(`Mentions ${list(companies)}, ${companies.length > 1 ? "companies" : "a company"} you follow.`);
  if (people.length) sentences.push(`Mentions ${list(people)}, ${people.length > 1 ? "people" : "who"} you follow.`);
  if (/stock-market coverage/.test(reason)) sentences.push("Ranked lower because it's stock-market coverage.");
  if (sentences.length) return sentences.join(" ");
  if (/active user source/i.test(reason)) return "From one of your saved sources.";
  const keywords = item.matchedKeywords ?? [];
  return keywords.length ? `Matches ${list(keywords)}.` : null;
}
