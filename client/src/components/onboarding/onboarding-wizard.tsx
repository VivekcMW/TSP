import { useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Sparkles, ArrowLeft, ArrowRight, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { Progress } from "@/components/ui/progress";
import { normalizeOnboardingChoices, type OnboardingData } from "@/lib/onboarding-choices";
import { parsePublicationCandidate } from "@/lib/publication-candidates";
import { browserSearchEdition, type SuggestionKind, type SuggestionResult, type SuggestionStep } from "@/lib/onboarding-suggestions";
import { useFocusUnderstanding } from "@/hooks/use-focus-understanding";
import { useOnboardingAgent, type ResultMode } from "@/hooks/use-onboarding-agent";
import { AgentStep, type StepKind } from "@/components/onboarding/agent-step";
import { UnderstandingCard } from "@/components/onboarding/understanding-card";
import { reconcileKeywords, type WeightedKeyword } from "@shared/profile-preferences";
import { selectedPublicationCandidates, type PublicationCandidate } from "@shared/publication-preferences";

interface OnboardingWizardProps {
  onComplete: (data: OnboardingData) => void;
  isPending?: boolean;
  userIndustry?: string;
  userCountry?: string;
}

type Step = "identity" | "publications" | "topics" | "connections";
const STEPS: Step[] = ["identity", "publications", "topics", "connections"];
const AGENT_STEPS: Partial<Record<Step, SuggestionStep>> = { publications: "publications", topics: "topics", connections: "people" };
const ALL_AGENT_STEPS: SuggestionStep[] = ["publications", "topics", "people"];
const STEP_KINDS: Record<SuggestionStep, StepKind[]> = {
  publications: [{ kind: "source", label: "source" }],
  topics: [{ kind: "topic", label: "topic" }],
  people: [{ kind: "leader", label: "leader", heading: "People" }, { kind: "company", label: "company", heading: "Companies" }],
};
const KINDS: SuggestionKind[] = ["source", "topic", "leader", "company"];
const emptySets = () => Object.fromEntries(KINDS.map(kind => [kind, new Set<string>()])) as Record<SuggestionKind, Set<string>>;
const lower = (value: string) => value.trim().toLowerCase();

/** A typed website: bare domains get https://; anything unusable is rejected. */
function websiteCandidate(name: string, website: string): PublicationCandidate | undefined {
  const value = website.trim();
  if (!value) return undefined;
  return parsePublicationCandidate({ name, url: /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value.replace(/^\/\//, "")}` });
}

export function OnboardingWizard({ onComplete, isPending = false, userIndustry, userCountry }: Readonly<OnboardingWizardProps>) {
  const [currentStep, setCurrentStep] = useState<Step>("identity");
  const [focusDescription, setFocusDescription] = useState("");
  const [mode, setMode] = useState<"agent" | "manual">("manual");
  const [builtFor, setBuiltFor] = useState<string>();
  const [selectedPublications, setSelectedPublications] = useState<string[]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [selectedInfluencers, setSelectedInfluencers] = useState<string[]>([]);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [removed, setRemoved] = useState<Record<SuggestionKind, string[]>>({ source: [], topic: [], leader: [], company: [] });
  const [customCandidates, setCustomCandidates] = useState<PublicationCandidate[]>([]);
  const [customSource, setCustomSource] = useState("");
  const [customWebsite, setCustomWebsite] = useState("");
  const [websiteError, setWebsiteError] = useState(false);
  const [customKeyword, setCustomKeyword] = useState("");
  const [customInfluencer, setCustomInfluencer] = useState("");
  const [customCompany, setCustomCompany] = useState("");
  // Which selections the agent made and which the user chose; steering replaces only the agent's.
  const agentPicked = useRef(emptySets());
  const userChosen = useRef(emptySets());
  const searchEdition = useMemo(() => browserSearchEdition(userCountry), [userCountry]);

  const currentStepIndex = STEPS.indexOf(currentStep);
  const progress = ((currentStepIndex + 1) / STEPS.length) * 100;
  const agentStep = AGENT_STEPS[currentStep];

  const lists: Record<SuggestionKind, [string[], React.Dispatch<React.SetStateAction<string[]>>]> = {
    source: [selectedPublications, setSelectedPublications],
    topic: [selectedKeywords, setSelectedKeywords],
    leader: [selectedInfluencers, setSelectedInfluencers],
    company: [selectedCompanies, setSelectedCompanies],
  };

  const understanding = useFocusUnderstanding(focusDescription, userIndustry, currentStep === "identity" && !isPending);
  const summary = understanding.understanding;

  const applyResult = (step: SuggestionStep, result: SuggestionResult, resultMode: ResultMode) => {
    for (const { kind } of STEP_KINDS[step]) {
      const picks = result.picks.filter(name => result.items.find(item => item.name === name)?.kind === kind);
      const previouslyPicked = agentPicked.current[kind];
      const chosen = userChosen.current[kind];
      lists[kind][1](current => {
        const kept = resultMode === "steer" ? current.filter(name => chosen.has(name) || !previouslyPicked.has(name)) : current;
        const additions = picks.filter(name => !kept.some(existing => lower(existing) === lower(name)));
        return [...kept, ...additions].slice(0, 20);
      });
      agentPicked.current[kind] = new Set(resultMode === "steer" ? picks : [...previouslyPicked, ...picks]);
    }
  };

  const agent = useOnboardingAgent(agentStep, mode === "agent", {
    focusDescription,
    industry: userIndustry,
    searchEdition,
    understanding: summary ? { role: summary.role, industry: summary.industry, focusAreas: summary.focusAreas, region: summary.region, audience: summary.audience } : undefined,
    // Read when a request starts, so websites the agent found since this render are included.
    publications: () => selectedPublications.map(name => { const url = publicationUrl(name); return url ? { name, url } : { name }; }),
    topics: selectedKeywords,
    picks: { publications: selectedPublications, topics: selectedKeywords, people: [...selectedInfluencers, ...selectedCompanies] },
    removed: { publications: removed.source, topics: removed.topic, people: [...removed.leader, ...removed.company] },
  }, applyResult);

  // Every known website: the user's own first, then the agent's.
  const candidates = useMemo<PublicationCandidate[]>(() => [
    ...customCandidates,
    ...agent.catalog.flatMap(item => item.kind === "source" && item.url ? [{ name: item.name, url: item.url }] : []),
  ], [customCandidates, agent.catalog]);
  const keywordChoices = useMemo<WeightedKeyword[]>(() => agent.catalog.flatMap(item => item.kind === "topic" ? [{ keyword: item.name, weight: item.weight ?? 0.7 }] : []), [agent.catalog]);
  function publicationUrl(name: string) { return selectedPublicationCandidates([name], candidates)[0]?.url; }

  const toggle = (kind: SuggestionKind, name: string) => {
    if (isPending) return;
    const [list, setList] = lists[kind];
    if (list.includes(name)) {
      setList(list.filter(item => item !== name));
      setRemoved(current => ({ ...current, [kind]: [...current[kind].filter(item => lower(item) !== lower(name)), name] }));
      userChosen.current[kind].delete(name);
      agentPicked.current[kind].delete(name);
    } else if (list.length < 20) {
      setList([...list, name]);
      setRemoved(current => ({ ...current, [kind]: current[kind].filter(item => lower(item) !== lower(name)) }));
      userChosen.current[kind].add(name);
    }
  };

  const addCustom = (kind: SuggestionKind, value: string, clear: () => void) => {
    const [list, setList] = lists[kind];
    const trimmed = value.trim();
    if (isPending || !trimmed || list.length >= 20 || list.some(item => lower(item) === lower(trimmed))) return false;
    setList(normalizeOnboardingChoices([...list, trimmed]));
    setRemoved(current => ({ ...current, [kind]: current[kind].filter(item => lower(item) !== lower(trimmed)) }));
    userChosen.current[kind].add(trimmed);
    clear();
    return true;
  };

  const addSource = () => {
    const name = customSource.trim();
    const website = customWebsite.trim();
    const candidate = websiteCandidate(name, website);
    if (website && !candidate) { setWebsiteError(true); return; }
    if (!addCustom("source", name, () => { setCustomSource(""); setCustomWebsite(""); })) return;
    setWebsiteError(false);
    if (candidate) setCustomCandidates(current => [...current.filter(item => lower(item.name) !== lower(name)), candidate]);
  };

  const buildSetup = () => {
    const focus = focusDescription.trim();
    if (focus.length < 10 || isPending) return;
    if (focus !== builtFor) { agent.reset(); setBuiltFor(focus); }
    setMode("agent");
    setCurrentStep("publications");
    void agent.run(ALL_AGENT_STEPS);
  };

  const setUpManually = () => {
    agent.cancel();
    setMode("manual");
    setCurrentStep("publications");
  };

  const letAgentHelp = () => {
    if (!agentStep || isPending) return;
    setBuiltFor(focusDescription.trim());
    setMode("agent");
    void agent.run(ALL_AGENT_STEPS.slice(ALL_AGENT_STEPS.indexOf(agentStep)));
  };

  const goToNextStep = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < STEPS.length) setCurrentStep(STEPS[nextIndex]);
  };

  const goToPreviousStep = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) setCurrentStep(STEPS[prevIndex]);
  };

  const handleComplete = () => {
    if (focusDescription.trim().length < 10 || isPending) return;
    const chosenCandidates = selectedPublicationCandidates(selectedPublications, candidates);
    onComplete({
      focusDescription: focusDescription.trim(),
      publications: selectedPublications,
      ...(chosenCandidates.length ? { publicationCandidates: chosenCandidates } : {}),
      keywords: reconcileKeywords(selectedKeywords, keywordChoices),
      influencers: selectedInfluencers,
      companies: selectedCompanies,
    });
  };

  const canProceedFromIdentity = focusDescription.trim().length >= 10;
  const stepTitles: Record<Step, string> = { identity: "About You", publications: "News Sources", topics: "Topics", connections: "Inspiration" };

  const renderStep = (step: SuggestionStep, steerPlaceholder: string, addYourOwn: ReactNode) => (
    <AgentStep
      mode={mode}
      state={agent.state[step]}
      kinds={STEP_KINDS[step]}
      selected={kind => lists[kind][0]}
      lookup={(kind, name) => agent.catalog.find(item => item.kind === kind && lower(item.name) === lower(name))}
      disabled={(kind, name) => isPending || (!lists[kind][0].includes(name) && lists[kind][0].length >= 20)}
      isPending={isPending}
      steerPlaceholder={steerPlaceholder}
      onToggle={toggle}
      onSteer={instruction => { void agent.run([step], instruction); }}
      onRetry={() => agent.retry(step)}
      onStartAgent={letAgentHelp}
    >
      {addYourOwn}
    </AgentStep>
  );

  const customInput = (kind: SuggestionKind, label: string, placeholder: string, value: string, setValue: (value: string) => void, testId: string) => (
    <div className="flex gap-2">
      <Input value={value} aria-label={label} maxLength={100} placeholder={placeholder} className="flex-1" disabled={isPending}
        onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === "Enter") addCustom(kind, value, () => setValue("")); }}
        data-testid={`input-custom-${testId}`} />
      <Button variant="outline" onClick={() => addCustom(kind, value, () => setValue(""))} disabled={!value.trim() || lists[kind][0].length >= 20 || isPending}
        data-testid={`button-add-${testId}`}>Add</Button>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12 space-y-6 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:[overflow-wrap:anywhere]">
        <div className="text-center mb-8 space-y-6">
          <Link href="/">
            <div className="flex items-center justify-center gap-2 cursor-pointer" data-testid="link-logo-onboarding">
              <Zap className="w-10 h-10 text-primary fill-primary" />
              <span className="font-bold text-3xl text-primary">TheSocialPundit</span>
            </div>
          </Link>
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold mb-3" data-testid="text-onboarding-title">Set up your profile</h1>
            <p className="text-muted-foreground">Tell the agent about your work. It builds your sources, topics and people from live news, and you stay in control.</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Step {currentStepIndex + 1} of {STEPS.length}: {stepTitles[currentStep]}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-2" data-testid="progress-onboarding" />
        </div>

        {currentStep === "identity" && (
          <Card data-testid="section-identity">
            <CardHeader>
              <CardTitle className="text-lg">What's your professional focus?</CardTitle>
              <CardDescription className="mt-1">Describe your role, your niche and who you want to reach.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                aria-label="Professional focus"
                aria-describedby="focus-hint"
                required
                disabled={isPending}
                value={focusDescription}
                onChange={(e) => setFocusDescription(e.target.value)}
                placeholder="e.g., I'm a product leader at a fintech startup. I focus on product strategy, growth metrics, and building user-centric teams."
                className="min-h-[120px] resize-none"
                maxLength={200}
                data-testid="textarea-focus-description"
              />
              <span id="focus-hint" className="block text-xs text-muted-foreground">
                {focusDescription.length} / 200 {focusDescription.trim().length < 10 && "(min 10 characters)"}
              </span>
              <UnderstandingCard
                status={understanding.status}
                understanding={summary}
                disabled={isPending}
                onChange={understanding.setUnderstanding}
                onAnswer={understanding.answer}
                onRetry={understanding.retry}
              />
            </CardContent>
          </Card>
        )}

        {currentStep === "publications" && (
          <Card data-testid="section-sources">
            <CardHeader>
              <CardTitle className="text-lg">Your news sources</CardTitle>
              <CardDescription className="mt-1">
                {mode === "agent" ? "The agent picks publications covering your focus right now. Keep what fits, remove the rest, or add your own."
                  : "Add the publications you follow, or let the agent find them."} Up to 20; suggestions are not verified feeds.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {renderStep("publications", "e.g. more India-focused, or no general business news", (
                <div className="space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input aria-label="Source name" value={customSource} maxLength={100} placeholder="Publication name" className="flex-1" disabled={isPending}
                      onChange={event => setCustomSource(event.target.value)} onKeyDown={event => { if (event.key === "Enter") addSource(); }} />
                    <Input aria-label="Source website (optional)" value={customWebsite} maxLength={2048} placeholder="Website (optional)" className="flex-1" disabled={isPending}
                      aria-invalid={websiteError} onChange={event => { setCustomWebsite(event.target.value); setWebsiteError(false); }} onKeyDown={event => { if (event.key === "Enter") addSource(); }} />
                    <Button variant="outline" onClick={addSource} disabled={!customSource.trim() || selectedPublications.length >= 20 || isPending}>Add source</Button>
                  </div>
                  {websiteError && <p role="alert" className="text-xs text-destructive">Enter a valid website, or leave it empty.</p>}
                </div>
              ))}
              <p className="text-xs text-muted-foreground">{selectedPublications.length} selected</p>
              <ul className="space-y-2 text-xs text-muted-foreground" aria-label="Selected publication URLs">
                {selectedPublications.map((name) => {
                  const candidate = candidates.find(item => lower(item.name) === lower(name));
                  return <li key={name} className="[overflow-wrap:anywhere]">
                    <span className="font-medium">{name}</span>: {candidate ? <>{candidate.url} — <span>Unverified URL</span></> : <span>URL needed</span>}
                  </li>;
                })}
              </ul>
            </CardContent>
          </Card>
        )}

        {currentStep === "topics" && (
          <Card data-testid="section-topics">
            <CardHeader>
              <CardTitle className="text-lg">Your topics</CardTitle>
              <CardDescription className="mt-1">
                {mode === "agent" ? "Topics the agent found in recent headlines from your sources. Discover searches your highest-priority topics first."
                  : "Add the topics you want Discover to follow, or let the agent find them."} Up to 20.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {renderStep("topics", "e.g. add retail media, or fewer event topics",
                customInput("topic", "Custom topic", "Add a topic…", customKeyword, setCustomKeyword, "keyword"))}
              <p className="text-xs text-muted-foreground">{selectedKeywords.length} selected</p>
            </CardContent>
          </Card>
        )}

        {currentStep === "connections" && (
          <Card data-testid="section-connections">
            <CardHeader>
              <CardTitle className="text-lg">People and companies to follow</CardTitle>
              <CardDescription className="mt-1">Optional — up to 20 people and 20 companies, or finish without any.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {renderStep("people", "e.g. more founders, or only Indian companies", (
                <div className="space-y-2">
                  {customInput("leader", "Custom leader", "Add a person…", customInfluencer, setCustomInfluencer, "influencer")}
                  {customInput("company", "Custom company", "Add a company…", customCompany, setCustomCompany, "company")}
                </div>
              ))}
              <p className="text-xs text-muted-foreground">{selectedInfluencers.length + selectedCompanies.length} selected</p>
            </CardContent>
          </Card>
        )}

        <div className="sticky bottom-0 bg-background/95 backdrop-blur py-4 border-t -mx-4 px-4 [&_button]:h-auto [&_button]:min-h-11">
          <div className="flex flex-col gap-3 sm:flex-row">
            {currentStep !== "identity" && (
              <Button variant="outline" size="lg" onClick={goToPreviousStep} disabled={isPending} className="flex-1" data-testid="button-back">
                <ArrowLeft className="w-4 h-4 mr-2" />Back
              </Button>
            )}
            {currentStep === "identity" && (
              <>
                <Button size="lg" className="flex-1" onClick={buildSetup} disabled={!canProceedFromIdentity || isPending} data-testid="button-build">
                  <Sparkles className="w-4 h-4 mr-2" />Build my setup
                </Button>
                <Button size="lg" variant="outline" className="flex-1" onClick={setUpManually} disabled={!canProceedFromIdentity || isPending} data-testid="button-manual">
                  Set up manually<ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </>
            )}
            {currentStep === "publications" && (
              <Button size="lg" className="flex-1" onClick={goToNextStep} disabled={isPending} data-testid="button-continue">
                {selectedPublications.length ? "Continue" : "Skip sources"}<ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}
            {currentStep === "topics" && (
              <Button size="lg" className="flex-1" onClick={goToNextStep} disabled={isPending} data-testid="button-continue">
                {selectedKeywords.length ? "Continue" : "Skip topics"}<ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}
            {currentStep === "connections" && (
              <Button size="lg" className="flex-1" onClick={handleComplete} disabled={!canProceedFromIdentity || isPending} data-testid="button-complete-onboarding">
                {isPending ? (<><Sparkles className="w-4 h-4 mr-2 animate-pulse" />Saving preferences...</>) : (
                  <><Check className="w-4 h-4 mr-2" />{selectedInfluencers.length || selectedCompanies.length ? "Complete setup" : "Skip inspiration and finish"}</>
                )}
              </Button>
            )}
          </div>
          {currentStep === "identity" && <Button variant="ghost" className="mt-2 w-full" onClick={handleComplete} disabled={!canProceedFromIdentity || isPending}>{isPending ? "Saving preferences…" : "Skip optional preferences and finish"}</Button>}
          <p className="text-xs text-muted-foreground text-center mt-3">You can update these preferences anytime in settings.</p>
        </div>
      </div>
    </div>
  );
}
