import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Bold, Check, CheckSquare, ClipboardCopy, Eraser, Italic, List, ListOrdered, Undo2, WrapText } from "lucide-react";
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
  LINKEDIN_FORMATTER_TOOL_FAQS, LINKEDIN_FORMATTER_TOOL_PATH, LINKEDIN_FORMATTER_TOOL_SEO, LINKEDIN_POST_MAX_CHARACTERS,
  applyUnicodeStyle, clearUnicodeStyles, formatAsList, linkedInFormatterToolJsonLd, postStats, tidySpacing,
  type ListStyle, type UnicodeStyle,
} from "@shared/linkedin-formatter";

const TOOL = "linkedin_post_formatter";
const SAMPLE = "Most teams don't have a content problem. They have a consistency problem.\n\nHere's what changed when we started posting every week:\n\nmore inbound questions from the right people\nshorter sales calls, because buyers already knew our view\nhiring got easier\n\nWhat's stopping you from posting weekly?\n\n#ThoughtLeadership #B2BMarketing";

type Selection = { start: number; end: number };

export default function LinkedInPostFormatterPage() {
  const [text, setText] = useState(SAMPLE);
  const [history, setHistory] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hint, setHint] = useState("");
  const editor = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<Selection | null>(null);
  const stats = useMemo(() => postStats(text), [text]);

  useLayoutEffect(() => {
    const selection = pendingSelection.current;
    if (!selection || !editor.current) return;
    pendingSelection.current = null;
    editor.current.focus();
    editor.current.setSelectionRange(selection.start, selection.end);
  }, [text]);

  function commit(next: string, selection?: Selection) {
    if (next === text) return;
    setHistory(current => [...current.slice(-49), text]);
    pendingSelection.current = selection ?? null;
    setCopied(false);
    setText(next);
  }

  function selection(): Selection {
    const element = editor.current;
    return element ? { start: element.selectionStart, end: element.selectionEnd } : { start: 0, end: 0 };
  }

  function style(kind: UnicodeStyle | "clear") {
    const { start, end } = selection();
    if (start === end && kind !== "clear") {
      setHint("Select the words you want to style first.");
      return;
    }
    setHint("");
    const [from, to] = start === end ? [0, text.length] : [start, end];
    const styled = kind === "clear" ? clearUnicodeStyles(text.slice(from, to)) : applyUnicodeStyle(text.slice(from, to), kind);
    commit(text.slice(0, from) + styled + text.slice(to), { start: from, end: from + styled.length });
    track("tool_format_text", { tool: TOOL, action: kind });
  }

  function list(kind: ListStyle) {
    const { start, end } = selection();
    // Lists apply to whole lines: the selected ones, or the whole post when nothing is selected.
    const from = start === end ? 0 : text.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = text.indexOf("\n", Math.max(end - 1, from));
    const to = start === end || lineEnd === -1 ? text.length : lineEnd;
    const listed = formatAsList(text.slice(from, to), kind);
    setHint("");
    commit(text.slice(0, from) + listed + text.slice(to), { start: from, end: from + listed.length });
    track("tool_format_text", { tool: TOOL, action: `list_${kind}` });
  }

  function undo() {
    const previous = history.at(-1);
    if (previous === undefined) return;
    setHistory(current => current.slice(0, -1));
    setText(previous);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      track("tool_copy_post", { tool: TOOL });
    } catch {
      setCopied(false);
    }
  }

  const over = stats.remaining < 0;
  const toolbarButton = "h-9 px-3";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEO title={LINKEDIN_FORMATTER_TOOL_SEO.title} rawTitle canonical={LINKEDIN_FORMATTER_TOOL_PATH}
        description={LINKEDIN_FORMATTER_TOOL_SEO.description} jsonLd={linkedInFormatterToolJsonLd()} />
      <SiteHeader />
      <main className="flex-1">
        <section className="bg-muted/30 py-10 lg:py-14">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal variants={fadeUp} className="mx-auto max-w-3xl text-center">
              <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-info">Free tool · No sign-up · Runs in your browser</p>
              <h1 className="heading-section mb-4 text-4xl sm:text-5xl" data-testid="text-formatter-headline">Free LinkedIn post formatter and character counter</h1>
              <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
                Add bold and italic text, bullet lists and clean spacing, count characters against LinkedIn's {LINKEDIN_POST_MAX_CHARACTERS.toLocaleString("en-US")} limit,
                and see exactly where "…see more" cuts your post.
              </p>
            </Reveal>

            <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
              <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
                <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" className={toolbarButton} onClick={() => style("bold")} data-testid="button-format-bold"><Bold className="mr-1.5 h-4 w-4" aria-hidden="true" />Bold</Button>
                  <Button type="button" variant="outline" size="sm" className={toolbarButton} onClick={() => style("italic")} data-testid="button-format-italic"><Italic className="mr-1.5 h-4 w-4" aria-hidden="true" />Italic</Button>
                  <Button type="button" variant="outline" size="sm" className={toolbarButton} onClick={() => style("boldItalic")}><Bold className="h-4 w-4" aria-hidden="true" /><Italic className="mr-1.5 h-4 w-4" aria-hidden="true" />Bold italic</Button>
                  <Button type="button" variant="outline" size="sm" className={toolbarButton} onClick={() => style("clear")} data-testid="button-format-clear"><Eraser className="mr-1.5 h-4 w-4" aria-hidden="true" />Clear style</Button>
                  <Button type="button" variant="outline" size="sm" className={toolbarButton} onClick={() => list("bullet")} data-testid="button-format-bullets"><List className="mr-1.5 h-4 w-4" aria-hidden="true" />Bullets</Button>
                  <Button type="button" variant="outline" size="sm" className={toolbarButton} onClick={() => list("arrow")}><ArrowRight className="mr-1.5 h-4 w-4" aria-hidden="true" />Arrows</Button>
                  <Button type="button" variant="outline" size="sm" className={toolbarButton} onClick={() => list("check")}><CheckSquare className="mr-1.5 h-4 w-4" aria-hidden="true" />Checks</Button>
                  <Button type="button" variant="outline" size="sm" className={toolbarButton} onClick={() => list("number")}><ListOrdered className="mr-1.5 h-4 w-4" aria-hidden="true" />Numbers</Button>
                  <Button type="button" variant="outline" size="sm" className={toolbarButton} onClick={() => commit(tidySpacing(text))} data-testid="button-format-tidy"><WrapText className="mr-1.5 h-4 w-4" aria-hidden="true" />Tidy spacing</Button>
                  <Button type="button" variant="ghost" size="sm" className={toolbarButton} onClick={undo} disabled={history.length === 0} data-testid="button-format-undo"><Undo2 className="mr-1.5 h-4 w-4" aria-hidden="true" />Undo</Button>
                </div>
                <p className="min-h-4 text-xs text-muted-foreground" aria-live="polite">{hint || "Select text to style it. Lists apply to the selected lines, or the whole post."}</p>
                <Label htmlFor="formatter-text" className="sr-only">Your LinkedIn post</Label>
                <Textarea id="formatter-text" ref={editor} rows={16} value={text} className="text-base leading-relaxed"
                  onChange={event => { setText(event.target.value); setCopied(false); }} data-testid="input-formatter-text" />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className={`text-sm ${over ? "font-medium text-destructive" : "text-muted-foreground"}`} aria-live="polite" data-testid="text-formatter-count">
                    {stats.characters.toLocaleString("en-US")} / {LINKEDIN_POST_MAX_CHARACTERS.toLocaleString("en-US")} characters
                    {over ? ` · ${Math.abs(stats.remaining).toLocaleString("en-US")} over the limit` : ""}
                  </p>
                  <Button type="button" onClick={copy} disabled={!text.trim()} data-testid="button-copy-formatted">
                    {copied ? <><Check className="mr-1.5 h-4 w-4" aria-hidden="true" />Copied</> : <><ClipboardCopy className="mr-1.5 h-4 w-4" aria-hidden="true" />Copy post</>}
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border bg-card p-5 shadow-sm">
                  <h2 className="font-heading text-lg font-semibold text-foreground">Feed preview</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Roughly how your post shows in the feed before someone clicks.</p>
                  <div className="mt-4 whitespace-pre-wrap break-words rounded-xl border bg-background p-4 text-sm leading-relaxed text-foreground" data-testid="text-formatter-preview">
                    {expanded || !stats.truncated ? text : stats.preview}
                    {stats.truncated && (
                      <button type="button" className="ml-1 font-medium text-muted-foreground hover:text-primary hover:underline" onClick={() => setExpanded(value => !value)}>
                        {expanded ? " show less" : "…see more"}
                      </button>
                    )}
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-3 rounded-2xl border bg-card p-5 text-sm shadow-sm">
                  <div><dt className="text-muted-foreground">Words</dt><dd className="font-heading text-xl font-semibold text-foreground">{stats.words}</dd></div>
                  <div><dt className="text-muted-foreground">Reading time</dt><dd className="font-heading text-xl font-semibold text-foreground">{stats.readingMinutes} min</dd></div>
                  <div><dt className="text-muted-foreground">Characters left</dt><dd className={`font-heading text-xl font-semibold ${over ? "text-destructive" : "text-foreground"}`}>{stats.remaining.toLocaleString("en-US")}</dd></div>
                  <div><dt className="text-muted-foreground">Hashtags</dt><dd className={`font-heading text-xl font-semibold ${stats.hashtags > 5 ? "text-destructive" : "text-foreground"}`}>{stats.hashtags}</dd></div>
                </dl>
                {stats.hashtags > 5 && <p className="text-xs text-muted-foreground">Three to five hashtags is plenty. <Link href="/tools/linkedin-hashtag-generator" className="text-primary underline-offset-4 hover:underline">Pick better ones</Link>.</p>}
                <ToolSignupCta tool={TOOL} />
              </div>
            </div>
          </div>
        </section>

        <section className="py-16 lg:py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <h2 className="heading-section mb-6">How to format a LinkedIn post that gets read</h2>
            <div className="space-y-4 text-muted-foreground">
              <p>Most people read LinkedIn on a phone, so formatting is about making the post easy to scan. Keep paragraphs to one or two sentences with a blank line between them, and turn any list of three or more points into bullets.</p>
              <p>The first {`${210}`} characters or so are all that shows before "…see more", so put your strongest line first. If the opening doesn't land, try the <Link href="/tools/linkedin-hook-generator" className="font-medium text-primary underline-offset-4 hover:underline">free hook generator</Link>.</p>
              <p>Use bold for one key line at most. Bold and italic letters are special Unicode characters, so screen readers may spell them out and LinkedIn search may not match them. Never style names, keywords or whole paragraphs.</p>
            </div>
          </div>
        </section>

        <ToolFaqSection faqs={LINKEDIN_FORMATTER_TOOL_FAQS} />
        <MoreFreeTools current={LINKEDIN_FORMATTER_TOOL_PATH} />
      </main>
      <SiteFooter />
    </div>
  );
}
