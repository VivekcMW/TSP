import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { Check, ClipboardCopy, Link2, Loader2, Newspaper, PenLine, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { Reveal } from "@/components/motion/reveal";
import { fadeUp } from "@/lib/motion";
import { track } from "@/lib/analytics-consent";
import {
  LINKEDIN_POST_TOOL_DAILY_LIMIT, LINKEDIN_POST_TOOL_FAQS, LINKEDIN_POST_TOOL_PATH, LINKEDIN_POST_TOOL_SEO, LINKEDIN_POST_TOOL_TONES,
  MAX_ARTICLE_TEXT, MIN_ARTICLE_TEXT, linkedInPostToolJsonLd,
  type LinkedInPostToolResponse, type LinkedInPostToolTone,
} from "@shared/linkedin-post-tool";

type Source = "url" | "text";
type State = { status: "idle" } | { status: "working" } | { status: "done"; result: LinkedInPostToolResponse } | { status: "failed"; message: string; limited: boolean };

const STEPS = [
  { icon: Link2, title: "Add a news story", body: "Paste a link to a public article, or paste the article text if the site is paywalled." },
  { icon: Sparkles, title: "Pick a tone", body: "Professional, insightful, conversational or bold. The draft takes a clear position either way." },
  { icon: PenLine, title: "Edit and post", body: "You get a hook, the key facts, your take and a question for comments. Make it yours, then post it." },
];

const GENERIC_FAILURE = "Something went wrong writing your post. Please try again in a moment.";

export default function LinkedInPostGeneratorPage() {
  const [source, setSource] = useState<Source>("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [tone, setTone] = useState<LinkedInPostToolTone>("insightful");
  const [state, setState] = useState<State>({ status: "idle" });
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);

  const textTooShort = source === "text" && text.trim().length < MIN_ARTICLE_TEXT;
  const canSubmit = state.status !== "working" && (source === "url" ? url.trim().length > 0 : !textTooShort);

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setState({ status: "working" });
    setCopied(false);
    track("tool_generate_post", { tool: "linkedin_post_generator", source, tone });
    try {
      const response = await fetch("/api/public/tools/linkedin-post", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(source === "url" ? { url: url.trim(), tone } : { text: text.trim(), tone }),
      });
      const body = await response.json().catch(() => ({})) as Partial<LinkedInPostToolResponse> & { message?: string; code?: string };
      if (response.ok && typeof body.post === "string") {
        const result = { post: body.post, sourceTitle: body.sourceTitle ?? null, sourceUrl: body.sourceUrl ?? null };
        setDraft(result.post);
        setState({ status: "done", result });
        return;
      }
      const limited = response.status === 429 || body.code === "tool_busy";
      if (limited) track("tool_limit_reached", { tool: "linkedin_post_generator" });
      setState({ status: "failed", message: body.message ?? GENERIC_FAILURE, limited });
    } catch {
      setState({ status: "failed", message: GENERIC_FAILURE, limited: false });
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      track("tool_copy_post", { tool: "linkedin_post_generator" });
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEO title={LINKEDIN_POST_TOOL_SEO.title} rawTitle canonical={LINKEDIN_POST_TOOL_PATH}
        description={LINKEDIN_POST_TOOL_SEO.description} jsonLd={linkedInPostToolJsonLd()} />
      <SiteHeader />
      <main className="flex-1">
        <section className="bg-muted/30 py-10 lg:py-14">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <Reveal variants={fadeUp} className="text-center">
              <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-info">Free tool · No sign-up</p>
              <h1 className="heading-section mb-4 text-4xl sm:text-5xl" data-testid="text-post-tool-headline">Free LinkedIn post generator from news</h1>
              <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
                Paste a news article and get a LinkedIn post with a hook, the key facts, a clear take and a question that invites comments.
                Up to {LINKEDIN_POST_TOOL_DAILY_LIMIT} free posts a day.
              </p>
            </Reveal>

            <form onSubmit={generate} className="mt-8 space-y-6 rounded-2xl border bg-card p-6 shadow-sm sm:p-8" data-testid="form-post-tool">
              <div className="space-y-3">
                <span id="post-tool-source" className="text-sm font-medium text-foreground">Your news story</span>
                <SegmentedControl aria-labelledby="post-tool-source" className="flex">
                  <SegmentedControlItem selected={source === "url"} onClick={() => setSource("url")} data-testid="button-source-url">
                    <Link2 className="mr-1.5 h-4 w-4" aria-hidden="true" />Article link
                  </SegmentedControlItem>
                  <SegmentedControlItem selected={source === "text"} onClick={() => setSource("text")} data-testid="button-source-text">
                    <Newspaper className="mr-1.5 h-4 w-4" aria-hidden="true" />Paste text
                  </SegmentedControlItem>
                </SegmentedControl>
                {source === "url" ? (
                  <div className="space-y-2">
                    <Label htmlFor="post-tool-url" className="sr-only">Article link</Label>
                    <Input id="post-tool-url" type="url" inputMode="url" placeholder="https://www.example.com/news/story" value={url}
                      onChange={event => setUrl(event.target.value)} maxLength={2048} data-testid="input-post-tool-url" />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="post-tool-text" className="sr-only">Article text</Label>
                    <Textarea id="post-tool-text" rows={8} placeholder="Paste the article text here (a few paragraphs is enough)." value={text}
                      onChange={event => setText(event.target.value)} maxLength={MAX_ARTICLE_TEXT} data-testid="input-post-tool-text" />
                    <p className="text-xs text-muted-foreground">
                      {textTooShort ? `Paste at least ${MIN_ARTICLE_TEXT} characters (${text.trim().length} so far).` : `${text.trim().length.toLocaleString()} / ${MAX_ARTICLE_TEXT.toLocaleString()} characters`}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <span id="post-tool-tone" className="text-sm font-medium text-foreground">Tone</span>
                <SegmentedControl aria-labelledby="post-tool-tone" className="flex">
                  {LINKEDIN_POST_TOOL_TONES.map(item => (
                    <SegmentedControlItem key={item.value} selected={tone === item.value} onClick={() => setTone(item.value)} title={item.hint} data-testid={`button-tone-${item.value}`}>
                      {item.label}
                    </SegmentedControlItem>
                  ))}
                </SegmentedControl>
                <p className="text-xs text-muted-foreground">{LINKEDIN_POST_TOOL_TONES.find(item => item.value === tone)!.hint}</p>
              </div>

              <Button type="submit" size="lg" className="w-full" disabled={!canSubmit} data-testid="button-generate-post">
                {state.status === "working" ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Writing your post…</> : <><Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />Write my LinkedIn post</>}
              </Button>

              {state.status === "failed" && (
                <div role="alert" className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
                  <p className="font-medium text-destructive">{state.message}</p>
                  {state.limited && (
                    <Button asChild size="sm"><Link href="/sign-up" onClick={() => track("tool_signup_click", { tool: "linkedin_post_generator", placement: "limit" })}>Create a free account</Link></Button>
                  )}
                </div>
              )}
            </form>

            {state.status === "done" && (
              <div className="mt-8 space-y-4 rounded-2xl border bg-card p-6 shadow-sm sm:p-8" data-testid="section-post-result">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-heading text-xl font-semibold text-foreground">Your LinkedIn post</h2>
                  <Button type="button" variant="outline" size="sm" onClick={copy} data-testid="button-copy-post">
                    {copied ? <><Check className="mr-1.5 h-4 w-4" aria-hidden="true" />Copied</> : <><ClipboardCopy className="mr-1.5 h-4 w-4" aria-hidden="true" />Copy post</>}
                  </Button>
                </div>
                {state.result.sourceTitle && (
                  <p className="text-sm text-muted-foreground">Based on: {state.result.sourceUrl
                    ? <a href={state.result.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline hover:text-primary">{state.result.sourceTitle}</a>
                    : state.result.sourceTitle}</p>
                )}
                <Label htmlFor="post-tool-draft" className="sr-only">Generated post</Label>
                <Textarea id="post-tool-draft" rows={14} value={draft} onChange={event => setDraft(event.target.value)} className="text-base leading-relaxed" data-testid="text-generated-post" />
                <p className="text-xs text-muted-foreground">Check every fact against the article before you post. {draft.length.toLocaleString()} / 3,000 characters.</p>
                <div className="rounded-xl bg-muted p-5">
                  <p className="font-medium text-foreground">Want posts like this every week, in your own voice?</p>
                  <p className="mt-1 text-sm text-muted-foreground">TheSocialPundit finds the news that matters in your field, drafts posts the way you write, and schedules them after you approve.</p>
                  <Button asChild size="sm" className="mt-4">
                    <Link href="/sign-up" onClick={() => track("tool_signup_click", { tool: "linkedin_post_generator", placement: "result" })} data-testid="link-post-tool-signup">Start free</Link>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="py-16 lg:py-20">
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            <h2 className="heading-section mb-10 text-center">How the free generator works</h2>
            <ol className="grid gap-6 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="rounded-2xl border bg-card p-6">
                  <span className="mb-4 grid h-10 w-10 place-items-center rounded-lg bg-primary text-primary-foreground"><step.icon className="h-5 w-5" aria-hidden="true" /></span>
                  <h3 className="font-heading text-lg font-semibold text-foreground">{index + 1}. {step.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="bg-muted/30 py-16 lg:py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <h2 className="heading-section mb-6">What makes a news post work on LinkedIn</h2>
            <div className="space-y-4 text-muted-foreground">
              <p>Sharing a link with "Interesting read" rarely gets noticed. The posts that start conversations do three things: they make the news easy to grasp in a sentence or two, they add a point of view only someone in your field would have, and they ask a question people actually want to answer.</p>
              <p>Post soon after the story breaks, keep paragraphs short so the post reads well on a phone, and use two or three specific hashtags rather than ten generic ones. Most importantly, edit the draft until it sounds like you. Readers follow people, not press releases.</p>
              <p>If you want this done every week, <Link href="/how-it-works" className="font-medium text-primary underline-offset-4 hover:underline">TheSocialPundit</Link> watches the news in your industry, suggests the stories worth talking about and drafts posts in your own voice for you to approve.</p>
            </div>
          </div>
        </section>

        <section className="py-16 lg:py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <h2 className="heading-section mb-6">Frequently asked questions</h2>
            <div className="divide-y rounded-2xl border bg-card">
              {LINKEDIN_POST_TOOL_FAQS.map(faq => (
                <details key={faq.question} className="group p-5">
                  <summary className="cursor-pointer list-none font-medium text-foreground">{faq.question}</summary>
                  <p className="mt-3 text-sm text-muted-foreground">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
