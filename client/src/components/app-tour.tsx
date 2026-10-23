import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useLocation } from "wouter";
import { ArrowRight, Minimize2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export const APP_TOUR_STEPS = [
  {
    title: "Start by talking to Pundit",
    description: "Tell Pundit what you do and who you want to reach, then press Send. You can keep using the app while this guide is open, or select Next to keep exploring.",
    path: "/onboarding",
    targets: ['[aria-label="Message Pundit"]'],
  },
  {
    title: "Check what Pundit understood",
    description: "Wait for Pundit's reply, answer any clarification and review the summary. Choose Build my setup, or Set up manually. Errors stay visible in the conversation; the tour waits for your choice.",
    path: "/onboarding",
    targets: ['[data-app-tour="setup-build"]', '[aria-label="Message Pundit"]'],
  },
  {
    title: "Review your curated setup",
    description: "Review the suggested sources, topics, people and companies, or add your own. Choose at least one topic, company or person, then press Start my workspace. This step only completes after the server confirms your setup was saved.",
    path: "/onboarding",
    targets: ['[data-testid="button-complete-onboarding"]', '[data-app-tour="setup-tab"]'],
  },
  {
    title: "Connect an account (optional)",
    description: "Connect a supported account and finish its authorization to enable direct publishing and scheduling. The guide waits for a confirmed connection, or you can continue without one and use manual publishing. Focus and voice remain editable in Settings → Content.",
    path: "/dashboard/settings?tab=integrations",
    targets: ['[data-testid="button-connect-linkedin"]', '[data-testid^="button-connect-"]', '[data-testid="tab-integrations"]'],
  },
  {
    title: "Find a story in Discover",
    description: "Refresh the feed if needed, open a story and choose Write a post. The guide advances when Create opens. If there is no suitable story, use your own idea instead.",
    path: "/dashboard/discover",
    targets: ['[data-testid^="button-generate-"]', '[data-testid="button-refresh-inbox"]'],
  },
  {
    title: "Write your document",
    description: "Add a title and write at least 20 characters, or ask Pundit to draft from your attached story. Review any generated suggestion before using it. The guide waits until your document is ready to adapt.",
    path: "/dashboard/create",
    targets: ['[aria-label="Message Pundit"]', '[aria-label="Document title"]'],
  },
  {
    title: "Adapt your reviewed document",
    description: "Review the document, then choose Adapt for platforms. This opens the platform chooser; it does not generate or publish automatically.",
    path: "/dashboard/create",
    targets: ['[aria-label="Adapt for platforms"]'],
  },
  {
    title: "Choose platforms and generate",
    description: "Select the platforms you want and press Create platform versions. Wait for a generated version. If generation fails, resolve the error or retry explicitly; the guide will not advance on a failed request.",
    path: "/dashboard/create",
    targets: ['[data-testid="button-generate-selected"]', '[aria-label="Adapt for platforms"]'],
  },
  {
    title: "Review and save a version",
    description: "Check the platform preview and edit it if needed, then press Save draft. The guide waits for a successful save, not just a click. Nothing is published by saving.",
    path: "/dashboard/create",
    targets: ['[data-app-tour="save-version"]', '[aria-label="Your platform posts"]'],
  },
  {
    title: "Open your saved draft",
    description: "Your platform draft was saved. Open this exact draft in Content to review its publishing options. Other drafts will not complete this walkthrough.",
    path: "/dashboard/content",
    targets: ['[data-app-tour="saved-content-link"]', '[aria-label="Post preview"]'],
  },
  {
    title: "Review before publishing",
    description: "Read the saved text and destination, then choose Schedule or Publishing options. Resolve any readiness blockers. You can edit the draft first; nothing is sent by opening these controls.",
    path: "/dashboard/content",
    targets: ['[data-app-tour="draft-publishing-actions"]', '[aria-label="Post preview"]'],
  },
  {
    title: "Confirm your publishing choice",
    description: "Review the exact text, destination and any required approval. For scheduling, choose a future date, time and timezone and confirm the review checkbox. Only press the app's final publish or schedule button when ready. Without a connection, Copy & Open is a manual handoff, not verified publication. The guide waits for the actual result.",
    path: "/dashboard/content",
    targets: ['[data-app-tour="publishing-confirmation"]', '[data-testid="button-publish-now"]', '[aria-label="Post preview"]'],
  },
  {
    title: "Review your result",
    description: "Check the result below. A schedule is a future plan, manual handoff is not verified publication, and a demo or uncertain delivery must never be called published. Content and Calendar retain your post and its status.",
    path: "/dashboard/content",
    targets: ['[data-app-tour="publishing-result"]', '[aria-label="Post preview"]', '[aria-label="Calendar controls"]'],
  },
] as const;

interface TourProgress {
  step: number;
  ready?: boolean;
  dismissed: boolean;
  completed: boolean;
  draftId?: string;
  outcome?: TourOutcome;
}

export type TourEvent = "focus-submitted" | "setup-started" | "setup-saved" | "connected" | "create-opened" |
  "document-ready" | "platforms-opened" | "versions-ready" | "draft-saved" | "draft-opened" |
  "publishing-opened" | "publishing-result";
export type TourOutcome = "scheduled" | "published" | "manual" | "simulated" | "attention";
const STEP_EVENTS: readonly TourEvent[] = [
  "focus-submitted", "setup-started", "setup-saved", "connected", "create-opened", "document-ready",
  "platforms-opened", "versions-ready", "draft-saved", "draft-opened", "publishing-opened", "publishing-result",
];
interface AppTourContextValue {
  openTour: () => void;
  /** Starts the tour at a step available in this phase; returns false otherwise. */
  startTourAt: (step: number) => boolean;
  canStartAt: (step: number) => boolean;
  report: (event: TourEvent, draftId?: string, outcome?: TourOutcome) => void;
  step: number;
  active: boolean;
  draftId?: string;
}

const AppTourContext = createContext<AppTourContextValue | null>(null);
const TOUR_STORAGE_PREFIX = "tsp-app-tour:v3:";
const FIRST_WORKSPACE_STEP = 3;

interface TargetBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

function useTourTarget(open: boolean, targets: readonly string[]) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [bounds, setBounds] = useState<TargetBounds | null>(null);

  useEffect(() => {
    setTarget(null);
    setBounds(null);
    if (!open) return;
    let current: HTMLElement | null = null;
    let frame = 0;
    const resizeObserver = new ResizeObserver(() => scheduleMeasure());
    const measure = () => {
      frame = 0;
      const next = targets.flatMap(selector => Array.from(document.querySelectorAll<HTMLElement>(selector)))
        .find(element => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        }) ?? null;
      if (next !== current) {
        resizeObserver.disconnect();
        current = next;
        setTarget(next);
        if (next) {
          next.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
          resizeObserver.observe(next);
        }
      }
      if (!next) {
        setBounds(null);
        return;
      }
      const rect = next.getBoundingClientRect();
      const left = Math.max(4, rect.left - 6);
      const top = Math.max(4, rect.top - 6);
      const width = Math.max(0, Math.min(innerWidth - 4, rect.right + 6) - left);
      const height = Math.max(0, Math.min(innerHeight - 4, rect.bottom + 6) - top);
      setBounds(previous => previous?.left === left && previous.top === top && previous.width === width && previous.height === height
        ? previous : { left, top, width, height });
    };
    const scheduleMeasure = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer = new MutationObserver(scheduleMeasure);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden", "data-state"] });
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);
    document.addEventListener("transitionend", scheduleMeasure, true);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      observer.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      document.removeEventListener("transitionend", scheduleMeasure, true);
    };
  }, [open, targets]);

  const anchor = useMemo(() => ({
    current: target ?? {
      getBoundingClientRect: () => new DOMRect(window.innerWidth / 2, 80, 0, 0),
    },
  }), [target]);

  return { anchor, bounds, target };
}

function storageKey(scope: string) {
  return `${TOUR_STORAGE_PREFIX}${scope}`;
}

function readProgress(scope: string): TourProgress | null {
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") throw new Error("Invalid tour progress");
    const progress = value as Partial<TourProgress>;
    if (typeof progress.step !== "number" || !Number.isInteger(progress.step) || progress.step < 0 || progress.step >= APP_TOUR_STEPS.length) throw new Error("Invalid tour step");
    if (typeof progress.dismissed !== "boolean" || typeof progress.completed !== "boolean") throw new Error("Invalid tour status");
    if (progress.ready !== undefined && typeof progress.ready !== "boolean") throw new Error("Invalid tour readiness");
    const outcomes: readonly string[] = ["scheduled", "published", "manual", "simulated", "attention"];
    return { step: progress.step, ready: progress.ready === true, dismissed: progress.dismissed, completed: progress.completed,
      draftId: typeof progress.draftId === "string" ? progress.draftId : undefined,
      outcome: progress.outcome && outcomes.includes(progress.outcome) ? progress.outcome : undefined };
  } catch {
    console.warn("App tour progress could not be read. The tour will start from the beginning.");
    return null;
  }
}

function writeProgress(scope: string, progress: TourProgress) {
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(progress));
  } catch {
    console.warn("App tour progress could not be saved. It may restart after reloading.");
  }
}

export function useAppTour() {
  const context = useContext(AppTourContext);
  if (!context) throw new Error("useAppTour must be used within AppTourProvider");
  return context;
}

export function useAppTourSignal(event: TourEvent, ready: boolean, draftId?: string, outcome?: TourOutcome) {
  const context = useContext(AppTourContext);
  useEffect(() => {
    if (ready) context?.report(event, draftId, outcome);
  }, [context, event, ready, draftId, outcome]);
}

export function useAppTourReporter() {
  return useContext(AppTourContext)?.report;
}

export function AppTourButton() {
  const context = useContext(AppTourContext);
  if (!context) return null;
  return <Button variant="outline" size="sm" onClick={context.openTour}>App tour</Button>;
}

export function AppTourProvider({ children, scope, enabled, phase = "workspace" }: Readonly<{
  children: ReactNode;
  scope: string | null;
  enabled: boolean;
  phase?: "setup" | "workspace";
}>) {
  const [location, setLocation] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const firstStep = phase === "setup" ? 0 : FIRST_WORKSPACE_STEP;
  const [stepIndex, setStepIndex] = useState(firstStep);
  const [draftId, setDraftId] = useState<string>();
  const [outcome, setOutcome] = useState<TourOutcome>();
  const [ready, setReady] = useState(false);
  const progressRef = useRef<TourProgress>({ step: firstStep, dismissed: false, completed: false });
  const initializedScope = useRef<string | null>(null);
  const openRef = useRef(false);

  useEffect(() => {
    if (!enabled || !scope || initializedScope.current === scope) return;
    initializedScope.current = scope;
    const saved = readProgress(scope);
    const nextIndex = phase === "setup" ? Math.min(saved?.step ?? 0, FIRST_WORKSPACE_STEP - 1)
      : saved?.step === 2 && saved.ready ? 2 : Math.max(saved?.step ?? FIRST_WORKSPACE_STEP, FIRST_WORKSPACE_STEP);
    setStepIndex(nextIndex);
    setReady(saved?.step === nextIndex && saved.ready === true);
    setDraftId(saved?.draftId);
    setOutcome(saved?.outcome);
    progressRef.current = { ...saved, step: nextIndex, ready: saved?.step === nextIndex && saved.ready === true,
      dismissed: saved?.dismissed ?? false, completed: saved?.completed ?? false };
    const awaitingSetup = phase === "setup" && saved && saved.step >= FIRST_WORKSPACE_STEP;
    const shouldStart = !awaitingSetup && (!saved || (!saved.dismissed && !saved.completed));
    setIsOpen(shouldStart);
    openRef.current = shouldStart;
    if (shouldStart && phase === "workspace") setLocation(tourPath(nextIndex, saved?.draftId));
  }, [enabled, scope, setLocation, phase]);

  const persist = useCallback((progress: TourProgress) => {
    progressRef.current = progress;
    if (scope) writeProgress(scope, progress);
  }, [scope]);

  const report = useCallback((event: TourEvent, savedDraftId?: string, result?: TourOutcome) => {
    const current = progressRef.current;
    if (!openRef.current || current.ready || STEP_EVENTS[current.step] !== event) return;
    if (current.step >= 9 && (!savedDraftId || (current.draftId && savedDraftId !== current.draftId))) return;
    if (event === "draft-saved" && !savedDraftId) return;
    if (event === "publishing-result" && !result) return;
    const next = { ...current, ready: true,
      draftId: event === "draft-saved" || !current.draftId ? savedDraftId : current.draftId, outcome: result ?? current.outcome };
    persist(next);
    setMinimized(false);
    setReady(true);
    setDraftId(next.draftId);
    setOutcome(next.outcome);
  }, [persist]);

  const advance = useCallback(() => {
    const current = progressRef.current;
    if (!openRef.current || current.step >= APP_TOUR_STEPS.length - 1) return;
    const next = { ...current, step: current.step + 1, ready: false };
    persist(next);
    setMinimized(false);
    setReady(false);
    if (phase === "setup" && next.step >= FIRST_WORKSPACE_STEP) {
      // The workspace provider resumes the tour once onboarding is saved.
      if (current.ready) setLocation(tourPath(next.step, next.draftId));
      else { setIsOpen(false); openRef.current = false; }
      return;
    }
    setStepIndex(next.step);
    const nextPath = tourPath(next.step, next.draftId);
    const onCalendar = next.step >= 10 && location === "/dashboard/calendar";
    if (phase === "workspace" && !onCalendar && location !== nextPath.split("?")[0]) setLocation(nextPath);
  }, [persist, setLocation, phase, location]);

  const openTour = useCallback(() => {
    setMinimized(false);
    const saved = scope ? readProgress(scope) : null;
    const requested = saved?.completed ? firstStep : (saved?.step ?? firstStep);
    const nextIndex = phase === "setup" ? (requested < FIRST_WORKSPACE_STEP ? requested : 0)
      : requested === 2 && saved?.ready ? 2 : Math.max(requested, FIRST_WORKSPACE_STEP);
    setStepIndex(nextIndex);
    const next = { ...saved, step: nextIndex, ready: !saved?.completed && saved?.step === nextIndex && saved.ready === true, dismissed: false, completed: false };
    setReady(next.ready);
    if (saved?.completed) { next.draftId = undefined; next.outcome = undefined; }
    setDraftId(next.draftId);
    setOutcome(next.outcome);
    persist(next);
    setIsOpen(true);
    openRef.current = true;
    if (phase === "workspace") setLocation(tourPath(nextIndex, next.draftId));
  }, [persist, scope, setLocation, firstStep, phase]);

  const canStartAt = useCallback((step: number) => Boolean(scope) && enabled && step >= 0 && step < APP_TOUR_STEPS.length
    && (phase === "setup" ? step < FIRST_WORKSPACE_STEP : step >= FIRST_WORKSPACE_STEP), [scope, enabled, phase]);

  const startTourAt = useCallback((step: number) => {
    if (!canStartAt(step)) return false;
    const saved = scope ? readProgress(scope) : null;
    const draft = saved && !saved.completed ? saved.draftId : undefined;
    const next: TourProgress = { step, ready: false, dismissed: false, completed: false, draftId: draft };
    persist(next);
    setMinimized(false);
    setStepIndex(step);
    setReady(false);
    setDraftId(draft);
    setOutcome(undefined);
    setIsOpen(true);
    openRef.current = true;
    if (phase === "workspace") setLocation(tourPath(step, draft));
    return true;
  }, [canStartAt, persist, scope, setLocation, phase]);

  const dismiss = useCallback((completed = false) => {
    setIsOpen(false);
    openRef.current = false;
    persist({ ...progressRef.current, dismissed: true, completed });
  }, [persist]);

  const handleOpenChange = (open: boolean) => {
    if (!open && openRef.current) dismiss();
  };

  const activeStep = APP_TOUR_STEPS[stepIndex];
  const targets = ready && (stepIndex === 6 || stepIndex === 10) ? APP_TOUR_STEPS[stepIndex + 1].targets : activeStep.targets;
  const { anchor, bounds, target } = useTourTarget(isOpen, targets);
  const titleId = useId();
  const descriptionId = useId();
  const contextValue = useMemo(() => ({ openTour, startTourAt, canStartAt, report, step: stepIndex, draftId, active: isOpen }),
    [openTour, startTourAt, canStartAt, report, stepIndex, draftId, isOpen]);
  const expectedPath = tourPath(stepIndex, draftId);
  const onStepPage = location === expectedPath.split("?")[0] || (stepIndex >= 10 && location === "/dashboard/calendar")
    || (stepIndex === 2 && ready);
  const container = target?.closest<HTMLElement>('[role="dialog"]:not([data-testid="dialog-app-tour"])') ?? undefined;

  return <AppTourContext.Provider value={contextValue}>
    {children}
    <Popover.Root open={isOpen} onOpenChange={handleOpenChange}>
      <Popover.Anchor virtualRef={anchor} />
      <Popover.Portal>
        <div aria-hidden="true" className={`pointer-events-none fixed inset-0 z-[60] ${bounds ? "" : "bg-foreground/10"}`}>
          {bounds && <div data-testid="app-tour-spotlight" className="pointer-events-none fixed rounded-lg border-2 border-primary"
            style={{ ...bounds, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.18)" }} />}
        </div>
      </Popover.Portal>
      <Popover.Portal container={container}>
      {minimized ? <Button className="fixed right-4 top-4 z-[70] shadow-xl" onClick={() => setMinimized(false)}
        aria-label={`Show guide, step ${stepIndex + 1} of ${APP_TOUR_STEPS.length}`}>
        <Sparkles aria-hidden="true" className="h-4 w-4" />Show guide ({stepIndex + 1}/{APP_TOUR_STEPS.length})
      </Button> : <Popover.Content
        key={stepIndex}
        data-testid="dialog-app-tour"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        side={container && window.innerWidth >= 900 ? "right" : "bottom"}
        align="start"
        sideOffset={16}
        collisionPadding={16}
        sticky="always"
        className="z-[70] w-[min(23rem,calc(100vw-2rem))] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-xl border bg-card p-4 text-card-foreground shadow-xl outline-none"
        onOpenAutoFocus={event => event.preventDefault()}
        onEscapeKeyDown={() => dismiss()}
        onInteractOutside={event => event.preventDefault()}
        onCloseAutoFocus={event => {
          const focusTarget = phase === "setup"
            ? document.querySelector<HTMLInputElement>('[aria-label="Message Pundit"]:not(:disabled)')
            : target?.matches('a[href], button:not(:disabled), input:not(:disabled), [tabindex="0"]')
              ? target : document.querySelector<HTMLElement>('[data-testid="button-navbar-account"]');
          if (focusTarget) {
            event.preventDefault();
            focusTarget.focus();
          }
        }}
      >
        <div className="space-y-2">
          <p className="flex items-center gap-2 pr-16 text-xs font-semibold uppercase tracking-wide text-primary">
            <Sparkles aria-hidden="true" className="h-4 w-4" />
            TheSocialPundit app tour
          </p>
          <h2 id={titleId} className="pr-7 text-lg font-semibold">{activeStep.title}</h2>
          <p id={descriptionId} className="text-sm leading-relaxed text-muted-foreground">{activeStep.description}</p>
        </div>
        {outcome && stepIndex === APP_TOUR_STEPS.length - 1 && <p role="status" className="mt-3 text-sm font-medium" data-testid="app-tour-outcome">{OUTCOME_MESSAGES[outcome]}</p>}
        <Button variant="ghost" size="icon" aria-label="Minimize guide" title="Minimize guide to use the controls underneath" className="absolute right-10 top-2" onClick={() => setMinimized(true)}>
          <Minimize2 aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Close tour" className="absolute right-2 top-2" onClick={() => dismiss()}>
          <X aria-hidden="true" className="h-4 w-4" />
        </Button>
        {!target && <p role="status" className="mt-3 text-sm text-muted-foreground">Waiting for this control to appear. Follow the app's loading or error messages, or pause this guide and resume later.</p>}
        {ready && stepIndex < APP_TOUR_STEPS.length - 1 && <p role="status" className="mt-3 text-sm font-medium text-primary">Done. Select Next to continue.</p>}
        {phase === "setup" && stepIndex === FIRST_WORKSPACE_STEP - 1 && !ready && <p className="mt-3 text-sm text-muted-foreground">Finish setup to open your workspace. If you select Next now, the tour continues there after setup is saved.</p>}
        <div className="my-4 space-y-2" aria-label="Tour progress">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Step {stepIndex + 1} of {APP_TOUR_STEPS.length}</span>
            <span>{Math.round(((stepIndex + 1) / APP_TOUR_STEPS.length) * 100)}% complete</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={1} aria-valuemax={APP_TOUR_STEPS.length} aria-valuenow={stepIndex + 1} aria-label="Tour progress">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${((stepIndex + 1) / APP_TOUR_STEPS.length) * 100}%` }} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => dismiss()} data-testid="button-app-tour-skip">Skip tour</Button>
          <div className="flex flex-wrap justify-end gap-2">
            {!onStepPage && phase !== "setup" && <Button size="sm" onClick={() => setLocation(expectedPath)}>Return to this step</Button>}
            {stepIndex === 3 && !ready && <Button size="sm" onClick={() => report("connected")}>Continue without connecting</Button>}
            {stepIndex === 4 && !ready && <Button size="sm" variant="outline" onClick={() => setLocation("/dashboard/create")}>Use my own idea</Button>}
            {stepIndex === 9 && draftId && !ready && <Button size="sm" variant="outline" onClick={() => setLocation(expectedPath)}>Open saved draft</Button>}
            {stepIndex < APP_TOUR_STEPS.length - 1 && <Button size="sm" onClick={advance} data-testid="button-app-tour-next">
              Next<ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Button>}
            {stepIndex === APP_TOUR_STEPS.length - 1 && <Button size="sm" onClick={() => dismiss(true)}>Finish tour</Button>}
          </div>
        </div>
        {target && <Popover.Arrow aria-hidden="true" data-testid="app-tour-arrow" width={18} height={9} className="fill-card" />}
      </Popover.Content>}
      </Popover.Portal>
    </Popover.Root>
  </AppTourContext.Provider>;
}

function tourPath(step: number, draftId?: string) {
  const path = APP_TOUR_STEPS[step].path;
  return step >= 9 && draftId ? `${path}?draft=${encodeURIComponent(draftId)}` : path;
}

const OUTCOME_MESSAGES: Record<TourOutcome, string> = {
  scheduled: "Schedule confirmed. This post is planned for future delivery, not published yet. Review it in Calendar or Content.",
  published: "Publication confirmed by the application's live delivery status. Review the publishing receipt in Content.",
  manual: "Text copied and platform opened. Finish publishing there yourself; the application has not verified publication.",
  simulated: "Demo only. No live publication was confirmed. Review the simulation status in Content.",
  attention: "Delivery needs attention or is unverified. Inspect the target status before retrying; do not send a duplicate.",
};
