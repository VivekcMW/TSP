import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { Check, ClipboardCopy, Hash, Loader2 } from "lucide-react";
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
  LINKEDIN_HASHTAG_TOOL_DAILY_LIMIT, LINKEDIN_HASHTAG_TOOL_FAQS, LINKEDIN_HASHTAG_TOOL_PATH, LINKEDIN_HASHTAG_TOOL_SEO,
  MAX_HASHTAG_TEXT, MIN_HASHTAG_TEXT, linkedInHashtagToolJsonLd, type LinkedInHashtagToolResponse,
} from "@shared/linkedin-hashtag-tool";

type State = { status: "idle" } | { status: "working" } | { status: "done"; result: LinkedInHashtagToolResponse } | { status: "failed"; message: string; limited: boolean };

const GENERIC_FAILURE = "Something went wrong suggesting hashtags. Please try again in a moment.";
const TOOL = "linkedin_hashtag_generator";

export default function LinkedInHashtagGeneratorPage() {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const [selected, setSelected] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const tooShort = text.trim().length < MIN_HASHTAG_TEXT;
  const canSubmit = state.status !== "working" && !tooShort;

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setState({ status: "working" });
    setCopied(false);
    track("tool_generate_post", { tool: TOOL });
    try {
      const response = await fetch("/api/public/tools/linkedin-hashtags", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
      const body = await response.json().catch(() => ({})) as Partial<LinkedInHashtagToolResponse> & { message?: string; code?: string };
      if (response.ok && Array.isArray(body.broad) && Array.isArray(body.niche)) {
        // Pre-select a balanced set: two broad tags for reach, three niche tags to stand out.
        setSelected([...body.broad.slice(0, 2), ...body.niche.slice(0, 3)]);
        return setState({ status: "done", result: { broad: body.broad, niche: body.niche } });
      }
      const limited = response.status === 429 || body.code === "tool_busy";
      if (limited) track("tool_limit_reached", { tool: TOOL });
      setState({ status: "failed", message: body.message ?? GENERIC_FAILURE, limited });
    } catch {
      setState({ status: "failed", message: GENERIC_FAILURE, limited: false });
    }
  }

  function toggle(tag: string) {
    setCopied(false);
    setSelected(current => current.includes(tag) ? current.filter(item => item !== tag) : [...current, tag]);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(selected.join(" "));
      setCopied(true);
      track("tool_copy_post", { tool: TOOL });
    } catch {
      setCopied(false);
    }
  }

  const group = (title: string, hint: string, tags: string[]) => tags.length > 0 && (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{title} <span className="font-normal text-muted-foreground">· {hint}</span></p>
      <div className="flex flex-wrap gap-2">
        {tags.map(tag => (
          <button key={tag} type="button" onClick={() => toggle(tag)} aria-pressed={selected.includes(tag)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${selected.includes(tag) ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground hover:border-primary"}`}
            data-testid={`button-hashtag-${tag.slice(1).toLowerCase()}`}>
            {tag}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEO title={LINKEDIN_HASHTAG_TOOL_SEO.title} rawTitle canonical={LINKEDIN_HASHTAG_TOOL_PATH}
        description={LINKEDIN_HASHTAG_TOOL_SEO.description} jsonLd={linkedInHashtagToolJsonLd()} />
      <SiteHeader />
      <main className="flex-1">
        <section className="bg-muted/30 py-10 lg:py-14">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <Reveal variants={fadeUp} className="text-center">
              <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-info">Free tool · No sign-up</p>
              <h1 className="heading-section mb-4 text-4xl sm:text-5xl" data-testid="text-hashtag-tool-headline">Free LinkedIn hashtag generator</h1>
              <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
                Paste your post or describe its topic and get relevant hashtags: broad tags for reach and niche tags where you can stand out.
                Up to {LINKEDIN_HASHTAG_TOOL_DAILY_LIMIT} free runs a day.
              </p>
            </Reveal>

            <form onSubmit={generate} className="mt-8 space-y-6 rounded-2xl border bg-card p-6 shadow-sm sm:p-8" data-testid="form-hashtag-tool">
              <div className="space-y-2">
                <Label htmlFor="hashtag-tool-text">Your post or topic</Label>
                <Textarea id="hashtag-tool-text" rows={7} value={text} onChange={event => setText(event.target.value)} maxLength={MAX_HASHTAG_TEXT}
                  placeholder="Paste your LinkedIn post, or describe it: for example, lessons from moving a 40-person finance team to rolling forecasts."
                  data-testid="input-hashtag-tool-text" />
                <p className="text-xs text-muted-foreground">
                  {tooShort ? `Write at least ${MIN_HASHTAG_TEXT} characters (${text.trim().length} so far).` : `${text.trim().length.toLocaleString()} / ${MAX_HASHTAG_TEXT.toLocaleString()} characters`}
                </p>
              </div>

              <Button type="submit" size="lg" className="w-full" disabled={!canSubmit} data-testid="button-generate-hashtags">
                {state.status === "working" ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Finding hashtags…</> : <><Hash className="mr-2 h-4 w-4" aria-hidden="true" />Suggest hashtags</>}
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
              <div className="mt-8 space-y-5 rounded-2xl border bg-card p-6 shadow-sm sm:p-8" data-testid="section-hashtag-result">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-heading text-xl font-semibold text-foreground">Your hashtags</h2>
                  <Button type="button" variant="outline" size="sm" onClick={copy} disabled={selected.length === 0} data-testid="button-copy-hashtags">
                    {copied ? <><Check className="mr-1.5 h-4 w-4" aria-hidden="true" />Copied</> : <><ClipboardCopy className="mr-1.5 h-4 w-4" aria-hidden="true" />Copy {selected.length} selected</>}
                  </Button>
                </div>
                {group("Broad", "bigger audience, more competition", state.result.broad)}
                {group("Niche", "smaller, more relevant audience", state.result.niche)}
                <p className="text-xs text-muted-foreground">Tap a tag to add or remove it. Three to five tags per post is plenty.</p>
                <ToolSignupCta tool={TOOL} />
              </div>
            )}
          </div>
        </section>

        <section className="py-16 lg:py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <h2 className="heading-section mb-6">How to use hashtags on LinkedIn</h2>
            <div className="space-y-4 text-muted-foreground">
              <p>Hashtags help LinkedIn understand what your post is about and show it to people who follow those topics. They are a small boost, not a growth strategy: a strong opening line and a clear point of view matter far more.</p>
              <p>Use three to five tags at the end of the post. Mix one or two broad tags with two or three niche ones that describe your exact subject, industry or role. Write them in PascalCase (#SupplyChain, not #supplychain) so they are easier to read and work with screen readers.</p>
              <p>Need the post itself? Write the opening with the <Link href="/tools/linkedin-hook-generator" className="font-medium text-primary underline-offset-4 hover:underline">free hook generator</Link>, or turn a news story into a full draft with the <Link href="/tools/linkedin-post-generator" className="font-medium text-primary underline-offset-4 hover:underline">LinkedIn post generator</Link>.</p>
            </div>
          </div>
        </section>

        <ToolFaqSection faqs={LINKEDIN_HASHTAG_TOOL_FAQS} />
        <MoreFreeTools current={LINKEDIN_HASHTAG_TOOL_PATH} />
      </main>
      <SiteFooter />
    </div>
  );
}
