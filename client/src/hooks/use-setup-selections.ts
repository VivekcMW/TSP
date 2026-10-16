import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { normalizeOnboardingChoices, type OnboardingData } from "@/lib/onboarding-choices";
import { parsePublicationCandidate } from "@/lib/publication-candidates";
import type { SuggestedChoice, SuggestionKind, SuggestionResult, SuggestionStep } from "@/lib/onboarding-suggestions";
import type { ResultMode } from "@/hooks/use-onboarding-agent";
import { reconcileKeywords } from "@shared/profile-preferences";
import { selectedPublicationCandidates, type PublicationCandidate } from "@shared/publication-preferences";

export const KINDS: SuggestionKind[] = ["source", "topic", "leader", "company"];
export const KIND_STEP: Record<SuggestionKind, SuggestionStep> = { source: "publications", topic: "topics", leader: "people", company: "people" };
export const STEP_KINDS: Record<SuggestionStep, SuggestionKind[]> = { publications: ["source"], topics: ["topic"], people: ["leader", "company"] };
const LIMIT = 20;
const lower = (value: string) => value.trim().toLowerCase();
const emptySets = () => Object.fromEntries(KINDS.map(kind => [kind, new Set<string>()])) as Record<SuggestionKind, Set<string>>;

/** A typed website: bare domains get https://; anything the server would refuse is rejected. */
export function websiteCandidate(name: string, website: string): PublicationCandidate | undefined {
  const value = website.trim();
  if (!value) return undefined;
  return parsePublicationCandidate({ name, url: /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value.replace(/^\/\//, "")}` });
}

/**
 * What the user has in their setup. The agent's picks are merged in; steering replaces only the
 * agent's untouched picks. Removals are remembered so the agent never brings them back.
 */
export function useSetupSelections(locked: boolean) {
  const [sources, setSources] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [leaders, setLeaders] = useState<string[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [removed, setRemoved] = useState<Record<SuggestionKind, string[]>>({ source: [], topic: [], leader: [], company: [] });
  const [customCandidates, setCustomCandidates] = useState<PublicationCandidate[]>([]);
  const [lastTouched, setLastTouched] = useState<SuggestionStep>("publications");
  const agentPicked = useRef(emptySets());
  const userChosen = useRef(emptySets());

  const lists: Record<SuggestionKind, [string[], Dispatch<SetStateAction<string[]>>]> = {
    source: [sources, setSources], topic: [topics, setTopics], leader: [leaders, setLeaders], company: [companies, setCompanies],
  };

  const unremove = (kind: SuggestionKind, name: string) => setRemoved(current => ({ ...current, [kind]: current[kind].filter(item => lower(item) !== lower(name)) }));

  const toggle = (kind: SuggestionKind, name: string) => {
    if (locked) return;
    const [list, setList] = lists[kind];
    setLastTouched(KIND_STEP[kind]);
    if (list.includes(name)) {
      setList(list.filter(item => item !== name));
      setRemoved(current => ({ ...current, [kind]: [...current[kind].filter(item => lower(item) !== lower(name)), name] }));
      userChosen.current[kind].delete(name);
      agentPicked.current[kind].delete(name);
    } else if (list.length < LIMIT) {
      setList([...list, name]);
      unremove(kind, name);
      userChosen.current[kind].add(name);
    }
  };

  /** Adds the user's own entry; false when it is empty, a duplicate or over the limit. */
  const addCustom = (kind: SuggestionKind, value: string) => {
    const [list, setList] = lists[kind];
    const trimmed = value.trim();
    if (locked || !trimmed || list.length >= LIMIT || list.some(item => lower(item) === lower(trimmed))) return false;
    setList(normalizeOnboardingChoices([...list, trimmed]));
    unremove(kind, trimmed);
    userChosen.current[kind].add(trimmed);
    setLastTouched(KIND_STEP[kind]);
    return true;
  };

  /** Adds a source with an optional website. "invalid" when the website would be refused. */
  const addSource = (name: string, website: string): "added" | "invalid" | "ignored" => {
    const candidate = websiteCandidate(name.trim(), website);
    if (website.trim() && !candidate) return "invalid";
    if (!addCustom("source", name)) return "ignored";
    if (candidate) setCustomCandidates(current => [...current.filter(item => lower(item.name) !== lower(name)), candidate]);
    return "added";
  };

  const applyResult = (step: SuggestionStep, result: SuggestionResult, mode: ResultMode) => {
    for (const kind of STEP_KINDS[step]) {
      const picks = result.picks.filter(name => result.items.find(item => item.name === name)?.kind === kind);
      const previouslyPicked = agentPicked.current[kind];
      const chosen = userChosen.current[kind];
      lists[kind][1](current => {
        const kept = mode === "steer" ? current.filter(name => chosen.has(name) || !previouslyPicked.has(name)) : current;
        const additions = picks.filter(name => !kept.some(existing => lower(existing) === lower(name)));
        return [...kept, ...additions].slice(0, LIMIT);
      });
      agentPicked.current[kind] = new Set(mode === "steer" ? picks : [...previouslyPicked, ...picks]);
    }
  };

  /** Every known website (the user's own first, then Pundit's) and the save payload. */
  const withCatalog = (catalog: SuggestedChoice[]) => {
    const candidates: PublicationCandidate[] = [
      ...customCandidates,
      ...catalog.flatMap(item => item.kind === "source" && item.url ? [{ name: item.name, url: item.url }] : []),
    ];
    const keywordChoices = catalog.flatMap(item => item.kind === "topic" ? [{ keyword: item.name, weight: item.weight ?? 0.7 }] : []);
    const publicationUrl = (name: string) => selectedPublicationCandidates([name], candidates)[0]?.url;
    const completionData = (focusDescription: string): OnboardingData => {
      const chosen = selectedPublicationCandidates(sources, candidates);
      return {
        focusDescription: focusDescription.trim(),
        publications: sources,
        ...(chosen.length ? { publicationCandidates: chosen } : {}),
        keywords: reconcileKeywords(topics, keywordChoices),
        influencers: leaders,
        companies,
      };
    };
    return { candidates, publicationUrl, completionData };
  };

  return {
    lists, removed, lastTouched, setLastTouched, withCatalog,
    count: sources.length + topics.length + leaders.length + companies.length,
    toggle, addCustom, addSource, applyResult,
  };
}
