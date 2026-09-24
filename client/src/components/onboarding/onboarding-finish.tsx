import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Newspaper, Sparkles, Zap } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import type { OnboardingData } from "@/lib/onboarding-choices";
import { browserSearchEdition, parsePreviewHeadlines, previewTopics, type PreviewHeadline } from "@/lib/onboarding-suggestions";

interface OnboardingFinishProps {
  data: OnboardingData;
  userIndustry?: string;
  userCountry?: string;
  onOpenDashboard: () => void;
  onOpenDiscover: () => void;
}

const PREVIEW_TIMEOUT_MS = 15_000;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Shown after onboarding is saved: what was saved, plus real headlines Discover would find. */
export function OnboardingFinish({ data, userIndustry, userCountry, onOpenDashboard, onOpenDiscover }: Readonly<OnboardingFinishProps>) {
  const topics = useMemo(() => previewTopics(data.keywords), [data.keywords]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty">(topics.length ? "loading" : "empty");
  const [headlines, setHeadlines] = useState<PreviewHeadline[]>([]);

  useEffect(() => {
    if (!topics.length) return;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, PREVIEW_TIMEOUT_MS);
    setStatus("loading");
    apiRequest("POST", "/api/onboarding/suggestions", {
      step: "preview",
      focusDescription: data.focusDescription,
      ...(userIndustry ? { industry: userIndustry } : {}),
      searchEdition: browserSearchEdition(userCountry),
      publications: data.publicationCandidates ?? [],
      topics,
      exclude: [],
    }, { signal: controller.signal })
      .then(response => response.json())
      .then(value => {
        if (controller.signal.aborted) return;
        const found = parsePreviewHeadlines(value);
        setHeadlines(found);
        setStatus(found.length ? "ready" : "empty");
      })
      // Leaving the page cancels quietly; a failure or timeout just skips the preview.
      .catch(() => { if (!controller.signal.aborted || timedOut) setStatus("empty"); })
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [topics, data, userIndustry, userCountry]);

  const saved = [
    data.publications.length ? count(data.publications.length, "source", "sources") : "",
    data.keywords.length ? count(data.keywords.length, "topic", "topics") : "",
    data.influencers.length + data.companies.length ? count(data.influencers.length + data.companies.length, "person or company", "people and companies") : "",
  ].filter(Boolean).join(" · ");

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12 space-y-6 [&_button]:max-w-full [&_button]:whitespace-normal [&_a]:[overflow-wrap:anywhere]">
        <Link href="/">
          <div className="flex items-center justify-center gap-2 cursor-pointer">
            <Zap className="w-10 h-10 text-primary fill-primary" />
            <span className="font-bold text-3xl text-primary">TheSocialPundit</span>
          </div>
        </Link>
        <Card data-testid="section-onboarding-finish">
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2 text-primary"><Check className="h-6 w-6 shrink-0" /></div>
            <CardTitle role="heading" aria-level={1} className="text-2xl">Your Discover is ready</CardTitle>
            <CardDescription>{saved || "Your focus is saved."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <section aria-label="Discover preview" className="space-y-3 rounded-lg border border-dashed p-4">
              <p className="flex items-center gap-2 text-sm font-medium"><Newspaper className="h-4 w-4 shrink-0 text-primary" />A taste of what Discover will find</p>
              {status === "loading" && (
                <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4 shrink-0 animate-pulse" />Finding recent articles on your topics…
                </p>
              )}
              {status === "ready" && (
                <ul className="space-y-3">
                  {headlines.map(headline => (
                    <li key={headline.title} className="space-y-1">
                      {headline.link
                        ? <a href={headline.link} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{headline.title}</a>
                        : <span className="font-medium">{headline.title}</span>}
                      <p className="text-xs text-muted-foreground">
                        {[headline.source, headline.publishedAt ? new Date(headline.publishedAt).toLocaleDateString() : "", `on ${headline.topic}`].filter(Boolean).join(" · ")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {status === "empty" && (
                <p className="text-sm text-muted-foreground">
                  {topics.length ? "Discover fills in the first time you refresh it." : "Pick a few topics in Settings so Discover knows what to look for."}
                </p>
              )}
            </section>
            <div className="flex flex-col gap-3 sm:flex-row [&_button]:h-auto [&_button]:min-h-11">
              <Button size="lg" className="flex-1" onClick={onOpenDashboard}>Go to dashboard<ArrowRight className="ml-2 h-4 w-4" /></Button>
              <Button size="lg" variant="outline" className="flex-1" onClick={onOpenDiscover}>Open Discover</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
