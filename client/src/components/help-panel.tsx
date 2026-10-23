import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { CircleHelp, ExternalLink, Play, Search, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useAppTour } from "@/components/app-tour";
import { HELP_SECTIONS, matchesHelpQuery, sectionsForLocation, type HelpSection } from "@/lib/help-content";
import { track } from "@/lib/analytics-consent";

type HelpSource = "navbar" | "inline" | "link" | "shortcut";

interface HelpContextValue {
  openHelp: (sectionId?: string, source?: HelpSource) => void;
  isOpen: boolean;
}

const HelpContext = createContext<HelpContextValue | null>(null);

export function useHelp() {
  return useContext(HelpContext);
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export function HelpProvider({ children, phase = "workspace" }: Readonly<{ children: ReactNode; phase?: "setup" | "workspace" }>) {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);

  const openHelp = useCallback((sectionId?: string, source: HelpSource = "navbar") => {
    const section = HELP_SECTIONS.find(item => item.id === sectionId);
    if (!open) returnFocus.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement : null;
    setQuery("");
    setExpanded(section ? [section.id] : sectionsForLocation(location, search));
    setOpen(true);
    track("help_opened", { source, section: section?.id ?? "page" });
  }, [location, search, open]);

  // Deep links like ?help=publishing open the panel, then drop the parameter so a reload doesn't reopen it.
  useEffect(() => {
    const params = new URLSearchParams(search);
    const requested = params.get("help");
    if (requested === null) return;
    openHelp(requested, "link");
    params.delete("help");
    const rest = params.toString();
    setLocation(`${location}${rest ? `?${rest}` : ""}`, { replace: true });
  }, [search, location, openHelp, setLocation]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      event.preventDefault();
      openHelp(undefined, "shortcut");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openHelp]);

  const value = useMemo(() => ({ openHelp, isOpen: open }), [openHelp, open]);

  return <HelpContext.Provider value={value}>
    {children}
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md" data-testid="help-panel"
        onCloseAutoFocus={event => {
          // Not opened by a SheetTrigger, so return focus to whatever opened it (navbar or an inline "?").
          const target = returnFocus.current?.isConnected ? returnFocus.current
            : document.querySelector<HTMLElement>('[data-testid="button-navbar-help"]');
          if (target) { event.preventDefault(); target.focus(); }
        }}>
        <HelpPanelBody phase={phase} expanded={expanded} setExpanded={setExpanded} query={query} setQuery={setQuery}
          close={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  </HelpContext.Provider>;
}

function HelpPanelBody({ phase, expanded, setExpanded, query, setQuery, close }: Readonly<{
  phase: "setup" | "workspace";
  expanded: string[];
  setExpanded: (ids: string[]) => void;
  query: string;
  setQuery: (query: string) => void;
  close: () => void;
}>) {
  const [location] = useLocation();
  const search = useSearch();
  const { openTour } = useAppTour();
  const pageIds = sectionsForLocation(location, search);
  const searching = query.trim().length > 0;
  const results = HELP_SECTIONS.filter(section => matchesHelpQuery(section, query));
  const onPage = searching ? [] : HELP_SECTIONS.filter(section => pageIds.includes(section.id));
  const others = searching ? results : HELP_SECTIONS.filter(section => !pageIds.includes(section.id));

  const updateQuery = (next: string) => {
    setQuery(next);
    const matches = HELP_SECTIONS.filter(section => matchesHelpQuery(section, next));
    setExpanded(next.trim() && matches.length <= 3 ? matches.map(section => section.id) : []);
  };

  const onExpandedChange = (ids: string[]) => {
    ids.filter(id => !expanded.includes(id)).forEach(id => track("help_section_opened", { section: id }));
    setExpanded(ids);
  };

  return <>
    <SheetHeader className="space-y-1 border-b p-5 pr-16 text-left">
      <SheetTitle className="flex items-center gap-2"><CircleHelp aria-hidden="true" className="h-5 w-5 text-primary" />Help</SheetTitle>
      <SheetDescription>Learn how each feature works, step by step.</SheetDescription>
      <div className="relative pt-3">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-[calc(50%+0.375rem)] h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" value={query} onChange={event => updateQuery(event.target.value)} placeholder="Search help"
          aria-label="Search help" className="pl-9" data-testid="input-help-search" />
      </div>
    </SheetHeader>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      {searching && <p role="status" className="mb-2 text-xs text-muted-foreground">
        {results.length === 0 ? "No results. Try another word, or contact support below." : `${results.length} ${results.length === 1 ? "result" : "results"}`}
      </p>}
      <Accordion type="multiple" value={expanded} onValueChange={onExpandedChange}>
        {onPage.length > 0 && <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">On this page</h3>}
        {onPage.map(section => <HelpItem key={section.id} section={section} phase={phase} close={close} />)}
        {onPage.length > 0 && others.length > 0 && <h3 className="mb-1 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">All features</h3>}
        {others.map(section => <HelpItem key={section.id} section={section} phase={phase} close={close} />)}
      </Accordion>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t p-4">
      <Button variant="outline" size="sm" onClick={() => { close(); openTour(); }} data-testid="button-help-app-tour">
        <Sparkles aria-hidden="true" className="h-4 w-4" />App tour
      </Button>
      <Button variant="ghost" size="sm" asChild>
        <a href={`${import.meta.env.BASE_URL}contact`} target="_blank" rel="noreferrer" data-testid="link-help-support">
          Contact support<ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /><span className="sr-only">(opens in a new tab)</span>
        </a>
      </Button>
    </div>
  </>;
}

function HelpItem({ section, phase, close }: Readonly<{ section: HelpSection; phase: "setup" | "workspace"; close: () => void }>) {
  const { startTourAt, canStartAt } = useAppTour();
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const canShow = section.tourStep !== undefined && canStartAt(section.tourStep);
  const sendFeedback = (helpful: boolean) => {
    setFeedback(helpful);
    track("help_feedback", { section: section.id, helpful });
  };

  return <AccordionItem value={section.id} data-testid={`help-section-${section.id}`}>
    <AccordionTrigger className="py-3 text-left text-sm">{section.title}</AccordionTrigger>
    <AccordionContent className="space-y-3">
      <p className="text-muted-foreground">{section.summary}</p>
      <div>
        <h4 className="mb-1 font-medium">How to</h4>
        <ol className="list-decimal space-y-1 pl-5">{section.steps.map(step => <li key={step}>{step}</li>)}</ol>
      </div>
      {section.tips.length > 0 && <div className="rounded-md bg-muted p-3">
        <h4 className="mb-1 font-medium">Good to know</h4>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{section.tips.map(tip => <li key={tip}>{tip}</li>)}</ul>
      </div>}
      {(canShow || (section.link && phase === "workspace")) && <div className="flex flex-wrap gap-2">
        {canShow && <Button size="sm" onClick={() => { close(); startTourAt(section.tourStep!); }} data-testid={`button-help-show-${section.id}`}>
          <Play aria-hidden="true" className="h-3.5 w-3.5" />Show me
        </Button>}
        {section.link && phase === "workspace" && <Button size="sm" variant="outline" asChild>
          <Link href={section.link.href} onClick={close}>{section.link.label}</Link>
        </Button>}
      </div>}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {feedback === null ? <>
          <span>Was this helpful?</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Yes, “${section.title}” was helpful`} onClick={() => sendFeedback(true)}>
            <ThumbsUp aria-hidden="true" className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`No, “${section.title}” was not helpful`} onClick={() => sendFeedback(false)}>
            <ThumbsDown aria-hidden="true" className="h-3.5 w-3.5" />
          </Button>
        </> : <span role="status">{feedback ? "Thanks for your feedback." : "Thanks — we'll use this to improve this guide."}</span>}
      </div>
    </AccordionContent>
  </AccordionItem>;
}

export function HelpButton() {
  const help = useHelp();
  if (!help) return null;
  return <Button variant="ghost" size="sm" onClick={() => help.openHelp()} aria-haspopup="dialog" aria-expanded={help.isOpen}
    title="Help (?)" data-testid="button-navbar-help">
    <CircleHelp aria-hidden="true" className="h-4 w-4" /><span className="hidden sm:inline">Help</span><span className="sr-only sm:hidden">Help</span>
  </Button>;
}

/** Small "?" button next to a complex control that opens Help on one section. */
export function HelpLink({ section, label, text }: Readonly<{ section: string; label: string; text?: string }>) {
  const help = useHelp();
  if (!help) return null;
  if (text) return <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => help.openHelp(section, "inline")}
    data-testid={`button-help-link-${section}`}><CircleHelp aria-hidden="true" className="h-4 w-4" />{text}</Button>;
  return <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground"
    aria-label={`Help: ${label}`} title={`Help: ${label}`} onClick={() => help.openHelp(section, "inline")} data-testid={`button-help-link-${section}`}>
    <CircleHelp aria-hidden="true" className="h-4 w-4" />
  </Button>;
}
