import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { Check, ClipboardCopy, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { Reveal } from "@/components/motion/reveal";
import { MoreFreeTools, ToolFaqSection, ToolSignupCta } from "@/components/free-tools";
import { fadeUp } from "@/lib/motion";
import { track } from "@/lib/analytics-consent";
import {
  LINKEDIN_HOOK_TOOL_DAILY_LIMIT, LINKEDIN_HOOK_TOOL_FAQS, LINKEDIN_HOOK_TOOL_PATH, LINKEDIN_HOOK_TOOL_SEO,
  MAX_HOOK_TOPIC, MIN_HOOK_TOPIC, linkedInHookToolJsonLd, type LinkedInHook,
} from "@shared/linkedin-hook-tool";

type State = { status: "idle" } | { status: "working" } | { status: "done"; hooks: LinkedInHook[] } | { status: "failed"; message: string; limited: boolean };

const GENERIC_FAILURE = "Something went wrong writing your hooks. Please try again in a moment.";
const TOOL = "linkedin_hook_generator";

export default function LinkedInHookGeneratorPage() {
  const [topic, setTopic] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const [copied, setCopied] = useState<number | null>(null);

  const tooShort = topic.trim().length < MIN_HOOK_TOPIC;
  const canSubmit = state.status !== "working" && !tooShort;

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setState({ status: "working" });
    setCopied(null);
    track("tool_generate_post", { tool: TOOL });
    try {
      const response = await fetch("/api/public/tools/linkedin-hooks", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim() }),
      });
      const body = await response.json().catch(() => ({})) as { hooks?: LinkedInHook[]; message?: string; code?: string };
      if (response.ok && Array.isArray(body.hooks)) return setState({ status: "done", hooks: body.hooks });
      const limited = response.status === 429 || body.code === "tool_busy";
      if (limited) track("tool_limit_reached", { tool: TOOL });
      setState({ status: "failed", message: body.message ?? GENERIC_FAILURE, limited });
    } catch {
      setState({ status: "failed", message: GENERIC_FAILURE, limited: false });
    }
  }

  async function copy(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(index);
      track("tool_copy_post", { tool: TOOL });
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEO title={LINKEDIN_HOOK_TOOL_SEO.title} rawTitle canonical={LINKEDIN_HOOK_TOOL_PATH}
        description={LINKEDIN_HOOK_TOOL_SEO.description} jsonLd={linkedInHookToolJsonLd()} />
      <SiteHeader />
      <main className="flex-1">
        <section className="bg-muted/30 py-10 lg:py-14">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <Reveal variants={fadeUp} className="text-center">
              <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-info">Free tool · No sign-up</p>
              <h1 className="heading-section mb-4 text-4xl sm:text-5xl" data-testid="text-hook-tool-headline">Free LinkedIn hook generator</h1>
              <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
                Describe your post or paste your draft and get five opening lines in different styles, so readers click "see more".
                Up to {LINKEDIN_HOOK_TOOL_DAILY_LIMIT} free runs a day.
              </p>
            </Reveal>

            <form onSubmit={generate} className="mt-8 space-y-6 rounded-2xl border bg-card p-6 shadow-sm sm:p-8" data-testid="form-hook-tool">
              <div className="space-y-2">
                <Label htmlFor="hook-tool-topic">What is your post about?</Label>
                <Textarea id="hook-tool-topic" rows={6} value={topic} onChange={event => setTopic(event.target.value)} maxLength={MAX_HOOK_TOPIC}
                  placeholder="For example: Most mid-size manufacturers still plan inventory in spreadsheets. Here's what that costs them and the one change that helps most."
                  data-testid="input-hook-tool-topic" />
                <p className="text-xs text-muted-foreground">
                  {tooShort ? `Write at least ${MIN_HOOK_TOPIC} characters (${topic.trim().length} so far).` : `${topic.trim().length.toLocaleString()} / ${MAX_HOOK_TOPIC.toLocaleString()} characters`}
                </p>
              </div>

              <Button type="submit" size="lg" className="w-full" disabled={!canSubmit} data-testid="button-generate-hooks">
                {state.status === "working" ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Writing your hooks…</> : <><Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />Write 5 hooks</>}
              </Button>

              {state.status === "failed" && (
                <div role="alert" className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
                  <p className="font-medium text-destructive">{state.message}</p>
                  {state.limited && (
                    <Button asChild size="sm"><Link href="/sign-up" onClick={() => track("tool_signup_click", { tool: TOOL, placement: "limit" })}>Create a free account</Link></Button>
                  )}
                </div>
              )}
            </form>

            {state.status === "done" && (
              <div className="mt-8 space-y-4 rounded-2xl border bg-card p-6 shadow-sm sm:p-8" data-testid="section-hook-result">
                <h2 className="font-heading text-xl font-semibold text-foreground">Your hooks</h2>
                <ul className="space-y-3">
                  {state.hooks.map((hook, index) => (
                    <li key={hook.style} className="flex items-start justify-between gap-4 rounded-xl border p-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-info">{hook.style}</p>
                        <p className="mt-1 text-base text-foreground" data-testid={`text-hook-${index}`}>{hook.text}</p>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => copy(hook.text, index)} aria-label={`Copy the ${hook.style.toLowerCase()} hook`}>
                        {copied === index ? <Check className="h-4 w-4" aria-hidden="true" /> : <ClipboardCopy className="h-4 w-4" aria-hidden="true" />}
                      </Button>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">Check each hook says what your post actually says before you use it.</p>
                <ToolSignupCta tool={TOOL} />
              </div>
            )}
          </div>
        </section>

        <section className="py-16 lg:py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <h2 className="heading-section mb-6">What makes a LinkedIn hook work</h2>
            <div className="space-y-4 text-muted-foreground">
              <p>LinkedIn shows roughly the first two or three lines of a post before "…see more". That opening decides whether anyone reads the rest, so it has to make one specific promise: a question the reader wants answered, a claim they want to test, or the start of a story they want to finish.</p>
              <p>Good hooks are short, concrete and honest. "3 signs your forecast is lying to you" beats "Some thoughts on forecasting". Avoid clickbait the post doesn't pay off: readers notice, and they stop clicking your posts.</p>
              <p>Try two or three of the styles below on the same post and pick the one that sounds most like you. To turn a news story into a full post, use the <Link href="/tools/linkedin-post-generator" className="font-medium text-primary underline-offset-4 hover:underline">free LinkedIn post generator</Link>.</p>
            </div>
          </div>
        </section>

        <ToolFaqSection faqs={LINKEDIN_HOOK_TOOL_FAQS} />
        <MoreFreeTools current={LINKEDIN_HOOK_TOOL_PATH} />
      </main>
      <SiteFooter />
    </div>
  );
}
