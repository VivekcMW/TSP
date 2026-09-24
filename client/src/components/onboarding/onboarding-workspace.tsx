import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Send, Zap } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { OnboardingData } from "@/lib/onboarding-choices";
import { browserSearchEdition, type SuggestionKind, type SuggestionStep, type PreviewHeadline } from "@/lib/onboarding-suggestions";
import { STORY_LINK_KEY } from "@/lib/create-story-link";
import { useFocusUnderstanding } from "@/hooks/use-focus-understanding";
import { useOnboardingAgent } from "@/hooks/use-onboarding-agent";
import { useSetupSelections } from "@/hooks/use-setup-selections";
import { useDiscoverPreview } from "@/hooks/use-discover-preview";
import { PunditPanel, type PanelMessage, type ProgressItem } from "@/components/onboarding/pundit-panel";
import { SetupCanvas } from "@/components/onboarding/setup-canvas";
import { SetupSection, type SectionKind } from "@/components/onboarding/setup-section";
import { UnderstandingCard } from "@/components/onboarding/understanding-card";

interface OnboardingWorkspaceProps {
  onComplete: (data: OnboardingData) => void;
  isPending?: boolean;
  userIndustry?: string;
  userCountry?: string;
  /** What was saved; the workspace then shows the finish view. */
  completed?: OnboardingData | null;
}

type Stored =
  | { id: number; from: "user"; text: string; about?: string }
  | { id: number; from: "pundit"; text: string; step?: SuggestionStep; actions?: "start" | "manual" | "understand-failed" | "finish" }
  | { id: number; from: "pundit"; card: true };

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

const STEPS: SuggestionStep[] = ["publications", "topics", "people"];
const TITLES: Record<SuggestionStep, string> = { publications: "Sources", topics: "Topics", people: "People and companies" };
const KINDS: Record<SuggestionStep, SectionKind[]> = {
  publications: [{ kind: "source", label: "source" }],
  topics: [{ kind: "topic", label: "topic" }],
  people: [{ kind: "leader", label: "leader", heading: "People" }, { kind: "company", label: "company", heading: "Companies" }],
};
const GREETING = "Hi, I'm Pundit. Tell me what you do and who you want to reach. I'll build your news setup from what's being published right now.";
const DEFAULT_NOTES: Record<SuggestionStep, string> = {
  publications: "Here are the sources covering your focus right now. Keep what fits, remove the rest.",
  topics: "Here's what those sources are writing about.",
  people: "Here are people and companies named in that news.",
};
const MAX_FOCUS = 500;
const lower = (value: string) => value.trim().toLowerCase();
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Onboarding as one workspace: Pundit's conversation on the left, your setup filling in on the right. */
export function OnboardingWorkspace({ onComplete, isPending = false, userIndustry, userCountry, completed = null }: Readonly<OnboardingWorkspaceProps>) {
  const [, navigate] = useLocation();
  const [focus, setFocus] = useState("");
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"none" | "agent" | "manual">("none");
  const [builtFor, setBuiltFor] = useState<string>();
  const [tab, setTab] = useState<"pundit" | "setup">("pundit");
  const [about, setAbout] = useState<SuggestionStep>("publications");
  const [messages, setMessages] = useState<Stored[]>([{ id: 1, from: "pundit", text: GREETING }]);
  const [customSource, setCustomSource] = useState("");
  const [customWebsite, setCustomWebsite] = useState("");
  const [websiteError, setWebsiteError] = useState(false);
  const [customTopic, setCustomTopic] = useState("");
  const [customLeader, setCustomLeader] = useState("");
  const [customCompany, setCustomCompany] = useState("");
  const nextId = useRef(2);
  const add = (message: WithoutId<Stored>) => setMessages(list => [...list, { ...message, id: nextId.current++ } as Stored]);
  const searchEdition = useMemo(() => browserSearchEdition(userCountry), [userCountry]);
  const locked = isPending || Boolean(completed);

  const understanding = useFocusUnderstanding(userIndustry);
  const summary = understanding.understanding;
  const selections = useSetupSelections(locked);
  const [sources] = selections.lists.source;
  const [topics] = selections.lists.topic;
  const [leaders] = selections.lists.leader;
  const [companies] = selections.lists.company;

  const agent = useOnboardingAgent(mode === "agent" ? selections.lastTouched : undefined, mode === "agent" && !completed, {
    focusDescription: focus,
    industry: userIndustry,
    searchEdition,
    understanding: summary ? { role: summary.role, industry: summary.industry, focusAreas: summary.focusAreas, region: summary.region, audience: summary.audience } : undefined,
    publications: () => sources.map(name => { const url = catalog.publicationUrl(name); return url ? { name, url } : { name }; }),
    topics,
    picks: { publications: sources, topics, people: [...leaders, ...companies] },
    removed: { publications: selections.removed.source, topics: selections.removed.topic, people: [...selections.removed.leader, ...selections.removed.company] },
  }, {
    onResult: (step, result, runMode) => {
      selections.applyResult(step, result, runMode);
      add({ from: "pundit", text: result.note || DEFAULT_NOTES[step], step });
    },
    onError: (step, message) => add({ from: "pundit", text: `${TITLES[step]}: ${message} You can add your own there, or press Try again.` }),
  });
  const catalog = selections.withCatalog(agent.catalog);
  const preview = useDiscoverPreview(completed, userIndustry, userCountry);

  // Pundit answers what it understood (once), or says it could not read it.
  const understandingStatus = useRef(understanding.status);
  useEffect(() => {
    const previous = understandingStatus.current;
    understandingStatus.current = understanding.status;
    if (previous === understanding.status) return;
    if (understanding.status === "ready" && !messages.some(message => "card" in message)) {
      add({ from: "pundit", card: true });
      add({ from: "pundit", text: "When this looks right, I'll build your setup from today's news.", actions: "start" });
    }
    if (understanding.status === "error") add({ from: "pundit", text: "I couldn't read that just now. You can try again, or build your setup anyway.", actions: "understand-failed" });
    // Only a change of status adds a message.
  }, [understanding.status]);

  useEffect(() => { setAbout(selections.lastTouched); }, [selections.lastTouched]);

  const finishedOnce = useRef(false);
  useEffect(() => {
    if (!completed || finishedOnce.current) return;
    finishedOnce.current = true;
    setTab("setup");
    add({ from: "pundit", text: "All set. Your Discover already has fresh stories. Want me to draft your first LinkedIn post from one of them?", actions: "finish" });
  }, [completed]);

  const buildSetup = (steps: SuggestionStep[] = STEPS) => {
    if (focus.trim().length < 10 || locked) return;
    if (focus !== builtFor) {
      if (builtFor !== undefined) agent.reset();
      setBuiltFor(focus);
    }
    setMode("agent");
    void agent.run(steps);
  };

  const setUpManually = () => {
    agent.cancel();
    setMode("manual");
    add({ from: "pundit", text: "No problem. Add what you follow on the right. Whenever you like, I can find the rest from live news.", actions: "manual" });
  };

  const steer = (step: SuggestionStep, instruction: string) => {
    add({ from: "user", text: instruction, about: TITLES[step] });
    if (mode !== "agent") setMode("agent");
    void agent.run([step], instruction);
  };

  const send = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || locked) return;
    setDraft("");
    if (mode !== "none") { steer(about, text); return; }
    add({ from: "user", text });
    if (!focus) {
      if (text.length < 10) { add({ from: "pundit", text: "Could you tell me a bit more about your work? A sentence or two helps me find the right news." }); return; }
      const next = text.slice(0, MAX_FOCUS);
      setFocus(next);
      understanding.understand(next);
      return;
    }
    if (summary?.question && understanding.status !== "loading") { understanding.answer(summary.question.text, text); return; }
    const next = `${focus} ${text}`.slice(0, MAX_FOCUS);
    setFocus(next);
    understanding.understand(next);
  };

  const writePost = (headline?: PreviewHeadline) => {
    if (headline?.link) navigate("/dashboard/create", { state: { [STORY_LINK_KEY]: headline.link } });
    else navigate("/dashboard/create");
  };

  const finish = () => {
    if (focus.trim().length < 10 || locked) return;
    onComplete(catalog.completionData(focus));
  };

  // What Pundit shows: stored messages plus the chips that still make sense now.
  const latestNote = new Map<SuggestionStep, number>();
  for (const message of messages) if ("step" in message && message.step) latestNote.set(message.step, message.id);
  const panelMessages: PanelMessage[] = messages.map(message => {
    if ("card" in message) {
      return { id: message.id, from: "pundit", card: (
        <UnderstandingCard status={understanding.status} understanding={summary} disabled={locked}
          onChange={understanding.setUnderstanding} onAnswer={understanding.answer} onRetry={understanding.retry} />
      ) };
    }
    if (message.from === "user") return message;
    const chips = [];
    if (message.actions === "start" && mode === "none" && !completed) {
      chips.push({ label: "Build my setup", primary: true, onClick: () => buildSetup(), disabled: locked }, { label: "Set up manually", onClick: setUpManually, disabled: locked });
    }
    if (message.actions === "understand-failed" && understanding.status === "error") chips.push({ label: "Try again", onClick: understanding.retry });
    if (message.actions === "manual" && mode === "manual" && !completed) chips.push({ label: "Let Pundit help", primary: true, onClick: () => buildSetup(), disabled: locked });
    if (message.actions === "finish") {
      chips.push({ label: "Draft a post from the first story", primary: true, onClick: () => writePost(preview.headlines[0]) }, { label: "Go to my dashboard", onClick: () => navigate("/dashboard") });
    }
    if (message.step && latestNote.get(message.step) === message.id && mode === "agent" && !completed && agent.state[message.step].status === "ready") {
      const step = message.step;
      for (const followUp of agent.state[step].followUps) chips.push({ label: followUp, onClick: () => steer(step, followUp), disabled: locked });
    }
    return { id: message.id, from: "pundit", text: message.text, chips };
  });

  const agentStarted = STEPS.some(step => agent.state[step].status !== "idle");
  const progress: ProgressItem[] | undefined = agentStarted ? [
    { label: "Understood your focus", state: summary ? "done" : "waiting", detail: summary ? [summary.role, summary.industry, summary.region].filter(Boolean).join(" · ") : "Skipped" },
    ...STEPS.map((step): ProgressItem => {
      const state = agent.state[step];
      if (state.status === "running") return { label: TITLES[step], state: "running", detail: state.feed.at(-1) ?? "Starting…" };
      if (state.status === "error") return { label: TITLES[step], state: "error", detail: state.error ?? "Couldn't finish" };
      if (state.status === "idle") return { label: TITLES[step], state: "waiting", detail: "Waiting" };
      const kindOf = (name: string) => state.items.find(item => item.name === name)?.kind;
      if (step === "people") {
        const people = state.picks.filter(name => kindOf(name) === "leader").length;
        return { label: TITLES[step], state: "done", detail: `Picked ${count(people, "person", "people")} and ${count(state.picks.length - people, "company", "companies")}` };
      }
      return { label: TITLES[step], state: "done", detail: `Picked ${step === "publications" ? count(state.picks.length, "source", "sources") : count(state.picks.length, "topic", "topics")}` };
    }),
  ] : undefined;
  const log = STEPS.flatMap(step => agent.state[step].feed);

  const lookup = (kind: SuggestionKind, name: string) => agent.catalog.find(item => item.kind === kind && lower(item.name) === lower(name));
  const disabled = (kind: SuggestionKind, name: string) => locked || (!selections.lists[kind][0].includes(name) && selections.lists[kind][0].length >= 20);
  const section = (step: SuggestionStep, addYourOwn: ReactNode) => (
    <SetupSection key={step} title={TITLES[step]} kinds={KINDS[step]} state={agent.state[step]} agentActive={mode === "agent"}
      selected={kind => selections.lists[kind][0]} lookup={lookup} disabled={disabled} onToggle={selections.toggle} onRetry={() => agent.retry(step)}>
      {addYourOwn}
    </SetupSection>
  );
  const textInput = (kind: SuggestionKind, label: string, placeholder: string, value: string, setValue: (value: string) => void, testId: string) => (
    <div className="flex gap-2">
      <Input value={value} aria-label={label} maxLength={100} placeholder={placeholder} className="flex-1" disabled={locked}
        onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && selections.addCustom(kind, value)) setValue(""); }}
        data-testid={`input-custom-${testId}`} />
      <Button variant="outline" className="min-h-10" disabled={!value.trim() || selections.lists[kind][0].length >= 20 || locked}
        onClick={() => { if (selections.addCustom(kind, value)) setValue(""); }} data-testid={`button-add-${testId}`}>Add</Button>
    </div>
  );
  const addSource = () => {
    const outcome = selections.addSource(customSource, customWebsite);
    if (outcome === "invalid") { setWebsiteError(true); return; }
    setWebsiteError(false);
    if (outcome === "added") { setCustomSource(""); setCustomWebsite(""); }
  };

  const view = completed ? "finished" : mode === "none" && selections.count === 0 ? "empty" : "setup";
  const summaryText = completed ? [
    completed.publications.length ? count(completed.publications.length, "source", "sources") : "",
    completed.keywords.length ? count(completed.keywords.length, "topic", "topics") : "",
    completed.influencers.length + completed.companies.length ? count(completed.influencers.length + completed.companies.length, "person or company", "people and companies") : "",
  ].filter(Boolean).join(" · ") || "Your focus is saved." : "";
  const placeholder = completed ? "Your setup is saved" : mode !== "none" ? "Tell Pundit what to change…"
    : !focus ? "Tell Pundit what you do and who you want to reach…" : summary?.question ? "Answer Pundit, or add more about your work…" : "Add more about your work…";

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center border-b bg-card px-4 sm:px-6">
        <Link href="/"><span className="flex cursor-pointer items-center gap-2" data-testid="link-logo-onboarding">
          <Zap className="h-6 w-6 fill-primary text-primary" /><span className="font-heading text-lg font-bold text-primary">TheSocialPundit</span>
        </span></Link>
      </header>
      <div role="tablist" aria-label="Onboarding" className="flex shrink-0 gap-1 border-b bg-muted p-1 lg:hidden">
        {(["pundit", "setup"] as const).map(value => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
            className={cn("min-h-10 flex-1 rounded-md text-sm", tab === value ? "bg-card font-semibold text-primary shadow-sm" : "text-muted-foreground")}>
            {value === "pundit" ? "Pundit" : `Your setup · ${selections.count}`}
          </button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[440px_minmax(0,1fr)]">
        <PunditPanel className={cn("col-start-1 row-start-1", tab === "pundit" ? "flex" : "hidden lg:flex")} messages={panelMessages}
          thinking={understanding.status === "loading" ? (summary ? "Pundit is updating what it understood…" : "Pundit is reading…") : undefined}
          progress={progress} log={log} />
        <SetupCanvas className={cn("col-start-1 row-start-1 lg:col-start-2 lg:row-span-2", tab === "setup" ? "flex" : "hidden lg:flex")}
          view={view} count={selections.count} canFinish={focus.trim().length >= 10} isPending={isPending} onFinish={finish}
          finished={completed ? { summary: summaryText, preview, onWritePost: writePost, onOpenDiscover: () => navigate("/dashboard/discover"), onOpenDashboard: () => navigate("/dashboard") } : undefined}>
          {section("publications", (
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input aria-label="Source name" value={customSource} maxLength={100} placeholder="Add your own publication" className="flex-1" disabled={locked}
                  onChange={event => setCustomSource(event.target.value)} onKeyDown={event => { if (event.key === "Enter") addSource(); }} />
                <Input aria-label="Source website (optional)" value={customWebsite} maxLength={2048} placeholder="Website (optional)" className="flex-1" disabled={locked}
                  aria-invalid={websiteError} onChange={event => { setCustomWebsite(event.target.value); setWebsiteError(false); }} onKeyDown={event => { if (event.key === "Enter") addSource(); }} />
                <Button variant="outline" className="min-h-10" onClick={addSource} disabled={!customSource.trim() || sources.length >= 20 || locked}>Add source</Button>
              </div>
              {websiteError && <p role="alert" className="text-xs text-destructive">Enter a valid website, or leave it empty.</p>}
              {sources.length > 0 && (
                <ul className="space-y-1 text-xs text-muted-foreground" aria-label="Selected publication URLs">
                  {sources.map(name => {
                    const candidate = catalog.candidates.find(item => lower(item.name) === lower(name));
                    return <li key={name} className="[overflow-wrap:anywhere]"><span className="font-medium">{name}</span>: {candidate ? <>{candidate.url} — <span>Unverified URL</span></> : <span>URL needed</span>}</li>;
                  })}
                </ul>
              )}
            </div>
          ))}
          {section("topics", textInput("topic", "Custom topic", "Add your own topic", customTopic, setCustomTopic, "keyword"))}
          {section("people", (
            <div className="space-y-2">
              {textInput("leader", "Custom leader", "Add a person", customLeader, setCustomLeader, "influencer")}
              {textInput("company", "Custom company", "Add a company", customCompany, setCustomCompany, "company")}
            </div>
          ))}
        </SetupCanvas>
        <form onSubmit={send} className="col-start-1 row-start-2 flex flex-col gap-2 border-t bg-card p-3 lg:border-r">
          {mode !== "none" && !completed && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              About
              <select aria-label="About" value={about} onChange={event => setAbout(event.target.value as SuggestionStep)} disabled={locked}
                className="min-h-8 rounded-md border bg-background px-2 text-xs text-foreground">
                {STEPS.map(step => <option key={step} value={step}>{TITLES[step]}</option>)}
              </select>
            </label>
          )}
          <div className="flex items-center gap-2 rounded-xl border px-3 py-1.5 focus-within:ring-2 focus-within:ring-ring">
            <input aria-label="Message Pundit" value={draft} onChange={event => setDraft(event.target.value)} maxLength={300} disabled={locked}
              placeholder={placeholder} className="min-h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" />
            <Button type="submit" size="icon" aria-label="Send" disabled={locked || !draft.trim()} className="h-10 w-10 shrink-0"><Send className="h-4 w-4" /></Button>
          </div>
        </form>
      </div>
    </div>
  );
}

