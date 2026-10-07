import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, FileText, MessageSquare, Paperclip, Plus, Save, SlidersHorizontal, Sparkles, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MAX_CREATION_REFERENCES } from "@shared/creation-session";
import { SocialPreviewCard } from "./social-preview-card";
import { EditorialDetails, EditorialProgress, SourceReview } from "./editorial-details";
import { WorkflowStatus } from "./workflow-status";
import { RichArticleEditor } from "./rich-article-editor";
import { DocumentEditor } from "./document-editor";
import { PunditWriting } from "./pundit-writing";
import { publicSourceUrl, versionCounts, versionKey } from "./create-post-state";
import type { CreatePostComposer } from "./use-create-post-composer";

const commands = [
  { key: "sources", label: "Attach articles", description: "Select several crawled articles from Discover" },
  { key: "tone", label: "Change tone", description: "Choose the voice for your next suggestion" },
  { key: "length", label: "Draft length", description: "Short draft or expanded article" },
  { key: "platforms", label: "Adapt for platforms", description: "Review this document, then choose up to four platforms" },
  { key: "versions", label: "View platform versions", description: "Review, copy, and save your platform drafts" },
  { key: "link", label: "Use an article link", description: "Start from a public publisher URL" },
  { key: "notes", label: "Source notes & attachments", description: "Supply your own material and upload media" },
  { key: "evidence", label: "Review sources", description: "Inspect evidence and generation details" },
  { key: "new", label: "Start a new document", description: "Replace this creation after confirmation" },
] as const;
type Action = typeof commands[number]["key"];

export function ArticleBentoBoard({ composer: c }: Readonly<{ composer: CreatePostComposer }>) {
  const [panel, setPanel] = useState<Action>();
  const [search, setSearch] = useState("");
  const [link, setLink] = useState("");
  const [conversationOpen, setConversationOpen] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const [dismissedCommands, setDismissedCommands] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const title = useRef<HTMLTextAreaElement>(null);
  const commandMenu = useRef<HTMLDivElement>(null);
  const commandList = useId();
  const slashQuery = c.chat.input.match(/(?:^|\s)\/([a-z]*)$/i)?.[1];
  const matchingCommands = commands.filter(command => `${command.key} ${command.label}`.toLowerCase().includes((slashQuery ?? "").toLowerCase()));
  const commandsOpen = slashQuery !== undefined && !dismissedCommands;
  const locked = c.busy || c.generation.recoverable || !c.persistence.ready;
  const counts = versionCounts(c.versions);
  const showingVersions = c.step === "versions";
  const selected = c.platforms.filter(platform => c.selectedPlatforms.includes(platform.value));
  const wordCount = c.main?.content.trim().split(/\s+/).filter(Boolean).length ?? 0;
  const saveStatus = { loading: "Loading...", saving: "Saving...", saved: "All changes saved", error: "Not saved", unsaved: "Unsaved changes" }[c.persistence.status];
  const availableArticles = c.item && !c.inbox.some(article => article.articleUrl === c.item?.articleUrl) ? [c.item, ...c.inbox] : c.inbox;
  const selectedArticles = c.chat.referenceUrls.map(url => ({ url, item: availableArticles.find(article => article.articleUrl === url) }));
  const stories = availableArticles.filter(article => `${article.headline} ${article.source}`.toLowerCase().includes(search.toLowerCase()));
  const panelTitle = commands.find(command => command.key === panel)?.label ?? "Draft actions";
  const documentKey = useMemo(() => crypto.randomUUID(), [c.sourceIdentity]);
  const waitingForSuggestion = Boolean(c.chat.pending && c.generation.pending);
  const sourceFailure = c.chat.failure ?? c.generation.sourceFailure;

  useEffect(() => {
    const paper = title.current?.parentElement;
    if (!paper) return;
    const resize = () => {
      const node = title.current;
      if (!node) return;
      node.style.height = "auto";
      node.style.height = `${node.scrollHeight}px`;
    };
    resize();
    let width = -1;
    const observer = new ResizeObserver(([entry]) => {
      if (width === entry.contentRect.width) return;
      width = entry.contentRect.width;
      resize();
    });
    observer.observe(paper);
    return () => observer.disconnect();
  }, [c.main?.title, showingVersions]);
  useEffect(() => { setCommandIndex(0); setDismissedCommands(false); }, [c.chat.input]);
  useEffect(() => {
    const node = input.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(96, node.scrollHeight)}px`;
  }, [c.chat.input]);
  useEffect(() => {
    commandMenu.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [commandsOpen, commandIndex]);

  const focusChat = () => requestAnimationFrame(() => input.current?.focus());
  const runAction = (action: Action) => {
    setActionNotice("");
    if (locked) { setActionNotice("Wait for the current operation before changing draft actions."); return; }
    c.setChatInput(c.chat.input.replace(/(?:^|\s)\/[a-z]*$/i, "").trimEnd());
    setDismissedCommands(true);
    if (action === "new") { c.startNewCreate(); return; }
    if (action === "versions") {
      if (!c.main) { setActionNotice("Write a document or apply a suggestion first."); return; }
      c.goToStep("versions"); return;
    }
    if (action === "platforms") {
      if (!c.mainReady) { setActionNotice("Add a title and at least 20 characters to your document first."); return; }
      c.choosePlatforms();
    }
    if (action === "link") setLink(c.url);
    setPanel(action);
  };
  const send = () => {
    if (c.chat.input.trim().startsWith("/")) {
      const command = commands.find(command => `/${command.key}` === c.chat.input.trim());
      if (command) runAction(command.key);
      else setActionNotice("Unknown command. Type / to see the available actions.");
      return;
    }
    setActionNotice("");
    void c.suggest();
  };

  return <div className="flex h-full min-h-0 min-w-0 flex-col bg-muted/20">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-card px-3 py-2 sm:px-5">
      <h1 className="sr-only" data-testid="text-page-title">Create post</h1>
      <div className="flex min-w-0 items-center gap-1" aria-label="Editor views">
        <Button variant={!showingVersions ? "secondary" : "ghost"} size="sm" aria-pressed={!showingVersions}
          onClick={() => c.goToStep(c.main ? "review" : "source")} disabled={locked}><FileText className="h-4 w-4" />Document</Button>
        <Button variant={showingVersions ? "secondary" : "ghost"} size="sm" aria-pressed={showingVersions}
          onClick={() => runAction("versions")} disabled={locked || !c.main}>Versions{counts.total ? ` (${counts.total})` : ""}</Button>
      </div>
      <div className="flex items-center gap-2">
        <output className="hidden text-xs text-muted-foreground sm:block" aria-live="polite">{saveStatus}</output>
        <Button variant="ghost" size="icon" aria-label="Save progress" disabled={!c.persistence.ready || c.persistence.status === "saving"} onClick={() => void c.persistence.save()}><Save className="h-4 w-4" /></Button>
        <Button size="sm" variant="outline" aria-label="Adapt for platforms" className="px-2 sm:px-3" disabled={locked || !c.mainReady} onClick={() => runAction("platforms")}><Sparkles className="h-4 w-4" /><span className="hidden sm:inline">Adapt for platforms</span></Button>
      </div>
    </header>

    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-5 sm:px-6 sm:py-8" data-testid="document-scroll-area">
      <div className="mx-auto mb-3 max-w-7xl space-y-2">
        {c.persistence.error && <WorkflowStatus tone="error" actions={<>
          {c.persistence.ready && <Button variant="outline" onClick={() => void c.persistence.save()}>Retry saving</Button>}
          <Button variant="outline" disabled={c.busy || c.generation.recoverable} onClick={c.persistence.reload}>Reload saved creation</Button>
        </>}>{c.persistence.error} Keep this tab open until your changes are saved.</WorkflowStatus>}
        {c.preferencesError && <WorkflowStatus tone="error" actions={<Button onClick={c.retryPreferences}>Retry preferences</Button>}>Could not load publishing preferences.</WorkflowStatus>}
        {c.notice && <WorkflowStatus tone="info">{c.notice}</WorkflowStatus>}
        {actionNotice && <WorkflowStatus tone="info">{actionNotice}</WorkflowStatus>}
      </div>
      {showingVersions ? <section aria-label="Your platform posts" className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="text-lg font-semibold">Platform versions</h2><p className="text-sm text-muted-foreground">{counts.saved} saved · {counts.unsaved} unsaved or unconfirmed</p></div>
          {c.batching && <Button variant="outline" disabled={c.batchStopRequested} onClick={c.stopBatchAfterCurrent}>Stop after current post</Button>}
          {c.hasBatchRecovery && !c.batching && <Button disabled={!c.canContinueBatch} onClick={() => void c.continueBatch()}>Continue remaining versions</Button>}
        </div>
        <p className="text-sm text-muted-foreground">Nothing is published automatically. Save a reviewed version to Content for supported scheduling and publishing.</p>
        {!selected.length && <p className="py-8 text-center text-muted-foreground">Use /platforms to choose the versions you want.</p>}
        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">{selected.map(platform => {
          const version = c.versions[versionKey(platform.value, c.tone)];
          return <div key={`${platform.value}:${c.tone}`} className="min-w-0 space-y-2">
            {c.staleVersion(platform.value, c.tone) && <WorkflowStatus tone="warning" live={false}>Document updated. Your earlier text is kept. Use /platforms to regenerate from your reviewed document.</WorkflowStatus>}
            <SocialPreviewCard composer={c} platform={platform.value} state={c.generationState(platform.value, c.tone) ?? (version ? "ready" : "idle")} />
          </div>;
        })}</div>
        {c.copyStatus && <WorkflowStatus>{c.copyStatus}</WorkflowStatus>}
      </section> : <div className="mx-auto min-w-0 max-w-7xl">
        <article aria-label="Editable document" className="min-w-0 rounded-sm border bg-card px-5 py-7 shadow-sm sm:px-10 sm:py-10">
          <div className="mb-4 flex min-h-11 flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />Your document
            {c.canUndoSuggestion && <span role="status"> · AI update ready</span>}
            <div className="ml-auto">{c.canUndoSuggestion
              ? <Button size="sm" variant="ghost" disabled={locked} onClick={c.undoSuggestion}><Undo2 className="h-3.5 w-3.5" />Undo AI update</Button>
              : <span>Editable</span>}</div>
          </div>
          {waitingForSuggestion && <PunditWriting elapsed={c.generation.elapsed} cancel={c.generation.cancel} />}
          {c.chat.proposal && <WorkflowStatus tone="warning" actions={<>
            <Button disabled={locked} onClick={c.applySuggestion}>Use generated draft</Button>
            <Button variant="outline" disabled={locked} onClick={c.discardSuggestion}>Discard</Button>
          </>}>{c.proposalStale ? "Your document changed while Pundit worked. Your edits have not been overwritten." : "A saved generated draft is ready. Your document has not been replaced."} Using it replaces the document text and formatting; Undo AI update restores your current version.</WorkflowStatus>}
          <Textarea ref={title} aria-label="Document title" rows={1} placeholder="Untitled draft" value={c.main?.title ?? ""} maxLength={200} disabled={locked}
            onChange={event => c.editDocument({ title: event.target.value })}
            className="mb-4 min-h-0 resize-none overflow-hidden rounded-none border-0 bg-transparent px-0 py-2 font-serif text-2xl font-semibold leading-snug shadow-none focus-visible:ring-1 md:text-3xl" />
          <DocumentEditor key={documentKey} content={c.main?.content ?? ""} formatJson={c.main?.formatJson} disabled={locked} onChange={c.editDocument} />
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground"><span>Document · {wordCount} words</span><span>{c.main?.content.length ?? 0} / 5,000</span></div>
          <p className="mt-2 text-xs text-muted-foreground">Formatting is saved in this document. Platform versions use plain text.</p>
        </article>
      </div>}
    </div>

    <section aria-label="Pundit chat" className="z-20 shrink-0 border-t bg-background px-3 pb-3 pt-2 sm:px-6" data-testid="sticky-chat">
      <div className="relative mx-auto max-w-7xl">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><span className="font-medium text-foreground">Pundit</span><span>Your writing partner</span></div>
          <div className="flex items-center gap-2">
            {!!c.chat.messages.length && <Button variant="ghost" size="sm" className="h-auto min-h-11 px-2 text-xs" aria-expanded={conversationOpen} onClick={() => setConversationOpen(!conversationOpen)}><MessageSquare className="h-3.5 w-3.5" />Conversation ({c.chat.messages.length})</Button>}
            <span className="sm:hidden">{saveStatus}</span>
          </div>
        </div>
        {conversationOpen && <div role="log" aria-label="Draft conversation" className="mb-2 max-h-36 space-y-2 overflow-y-auto rounded-md border bg-card p-3 text-sm">
          {c.chat.messages.map(message => <div key={message.id} className={message.role === "user" ? "ml-5 rounded-md bg-muted p-2" : "mr-5 p-2"}><span className="mb-1 block text-xs font-medium text-muted-foreground">{message.role === "user" ? "You" : "Pundit"}</span><p className="whitespace-pre-wrap break-words">{message.content}</p></div>)}
        </div>}
        {c.chat.pending && !c.generation.pending && !c.generation.recoverable && <WorkflowStatus tone="warning" actions={<Button variant="outline" onClick={c.discardSuggestion}>Dismiss interrupted suggestion</Button>}>A previous suggestion was interrupted. No new AI attempt has been started.</WorkflowStatus>}
        <div className="rounded-xl border bg-card p-2 shadow-sm focus-within:border-primary/50">
          {!!selectedArticles.length && <div className="mb-1 flex gap-1 overflow-x-auto" aria-label="Attached articles">{selectedArticles.map(({ url, item }) => <div key={url} className="flex max-w-full shrink-0 items-center rounded-md border bg-muted/40 pl-2 text-xs">
            <FileText className="mr-1 h-3.5 w-3.5 shrink-0" /><span className="max-w-40 truncate" title={item?.headline ?? url}>{item?.headline ?? url}</span>
            <Button size="icon" variant="ghost" className="h-11 w-11 shrink-0" aria-label={`Remove ${item?.headline ?? url}`} disabled={locked || Boolean(c.chat.pending)}
              onClick={() => c.setChatReferences(c.chat.referenceUrls.filter(value => value !== url))}><X className="h-3 w-3" /></Button>
          </div>)}</div>}
          <Textarea ref={input} aria-label="Message Pundit" placeholder="Suggest an edit or describe your idea... type / for actions"
            rows={1} maxLength={4000} value={c.chat.input} disabled={!c.persistence.ready}
            aria-controls={commandsOpen ? commandList : undefined}
            aria-activedescendant={commandsOpen && matchingCommands.length ? `${commandList}-${commandIndex}` : undefined}
            onChange={event => c.setChatInput(event.target.value)}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (commandsOpen && ["ArrowDown", "ArrowUp"].includes(event.key)) {
                event.preventDefault(); setCommandIndex(index => (index + (event.key === "ArrowDown" ? 1 : -1) + matchingCommands.length) % Math.max(1, matchingCommands.length)); return;
              }
              if (event.key === "Escape") { setDismissedCommands(true); return; }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (commandsOpen && matchingCommands[commandIndex]) runAction(matchingCommands[commandIndex].key);
                else if (!locked && c.preferencesReady && !c.chat.proposal && !c.chat.pending) send();
              }
            }}
            className="max-h-24 min-h-11 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0" />
          <div className="flex flex-wrap items-center justify-between gap-1">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" disabled={locked || Boolean(c.chat.pending)} onClick={() => runAction("sources")}><Paperclip className="h-4 w-4" />Articles{selectedArticles.length ? ` (${selectedArticles.length})` : ""}</Button>
              <Button variant="ghost" size="icon" aria-label="Open slash commands" aria-expanded={commandsOpen} aria-controls={commandList}
                disabled={!c.persistence.ready} onClick={() => { c.setChatInput(`${c.chat.input.trimEnd()} /`.trimStart()); focusChat(); }}><SlidersHorizontal className="h-4 w-4" /></Button>
              <span className="hidden text-xs text-muted-foreground sm:inline">/ actions · Shift+Enter for a new line</span>
            </div>
            <Button size="icon" aria-label="Send suggestion" disabled={locked || !c.preferencesReady || !c.chat.input.trim() || Boolean(c.chat.proposal || c.chat.pending)} onClick={send}><ArrowUp className="h-4 w-4" /></Button>
          </div>
        </div>
        {commandsOpen && <div ref={commandMenu} id={commandList} role="listbox" aria-label="Slash commands" className="absolute bottom-full left-0 right-0 z-30 mb-2 max-h-72 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
          {!matchingCommands.length && <p className="p-3 text-sm text-muted-foreground">No matching command. Try /sources, /tone, or /platforms.</p>}
          {matchingCommands.map((command, index) => <button type="button" id={`${commandList}-${index}`} key={command.key} role="option" aria-selected={index === commandIndex}
            onMouseDown={event => event.preventDefault()} onMouseEnter={() => setCommandIndex(index)} onClick={() => runAction(command.key)}
            className={`flex min-h-11 w-full items-center gap-3 rounded-md p-2 text-left ${index === commandIndex ? "bg-accent text-accent-foreground" : "text-popover-foreground"}`}>
            <span className="w-24 shrink-0 font-mono text-xs">/{command.key}</span><span className="min-w-0"><span className="block text-sm font-medium">{command.label}</span><span className="block text-xs text-muted-foreground">{command.description}</span></span>
          </button>)}
        </div>}
        <EditorialProgress {...c.generation} error={sourceFailure ? "" : c.generation.error} pending={c.generation.pending && !waitingForSuggestion} batch={c.batching ? c.batch : undefined} />
        {sourceFailure && <WorkflowStatus tone="error" title="Some sources could not be read" actions={<>
          {sourceFailure.sources.some(source => c.chat.referenceUrls.includes(source.url)) &&
            <Button variant="outline" disabled={locked} onClick={c.removeUnreadableSources}>Remove unavailable articles</Button>}
          <Button variant="outline" disabled={locked} onClick={() => runAction("notes")}>Add source notes</Button>
        </>}>
          <p>{sourceFailure.message}</p>
          <ul className="mt-1 max-h-24 overflow-y-auto text-xs">{sourceFailure.sources.map(source =>
            <li key={source.url}><a className="underline" href={source.url} target="_blank" rel="noopener noreferrer">{new URL(source.url).hostname}</a>: {source.message}</li>)}</ul>
          <p className="mt-1 text-xs">Your document, attachments and message have been kept. Sources are never silently skipped.</p>
        </WorkflowStatus>}
        {c.generation.recoverable && !c.generation.pending && <WorkflowStatus tone="warning" actions={<>
          <Button variant="outline" onClick={() => void c.generate(true)}>Retry same request</Button><Button variant="outline" onClick={() => void c.generation.cancel()}>Cancel generation</Button>
        </>}>Check the original request before starting another AI attempt.</WorkflowStatus>}
        <p className="mt-1 text-center text-xs text-muted-foreground">Pundit writes in your document. Review before publishing. AI requests may count toward usage.</p>
      </div>
    </section>

    <Dialog open={Boolean(panel)} onOpenChange={open => { if (!open) { setPanel(undefined); focusChat(); } }}>
      <DialogContent className="max-h-[85dvh] w-[calc(100%-1rem)] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{panelTitle}</DialogTitle><DialogDescription>Keep the document in focus. Change options here without generating automatically.</DialogDescription></DialogHeader>
        {panel === "sources" && <div className="space-y-3">
          <Input aria-label="Search crawled articles" placeholder="Search titles or publications..." value={search} onChange={event => setSearch(event.target.value)} />
          <p className="text-sm text-muted-foreground">Select up to {MAX_CREATION_REFERENCES} articles. Pundit reads the selected sources together when you send a suggestion.</p>
          {c.inboxLoading && <p role="status">Loading articles...</p>}
          {c.inboxError && <WorkflowStatus tone="error" actions={<Button onClick={() => void c.retryInbox()}>Retry articles</Button>}>Could not load your crawled articles.</WorkflowStatus>}
          {!c.inboxLoading && !c.inboxError && !stories.length && <p className="py-5 text-center text-sm text-muted-foreground">No matching articles. Refresh Discover or use /link to supply an article URL.</p>}
          <fieldset aria-label="Crawled articles" className="max-h-80 space-y-2 overflow-y-auto" disabled={locked || Boolean(c.chat.pending)}>
            {stories.map(article => {
              const checked = c.chat.referenceUrls.includes(article.articleUrl);
              return <label key={article.id} className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-md border p-3 ${checked ? "border-primary bg-primary/5" : ""}`}>
                <input type="checkbox" checked={checked} disabled={!checked && c.chat.referenceUrls.length >= MAX_CREATION_REFERENCES} className="mt-1 h-4 w-4 shrink-0 accent-primary"
                  onChange={() => c.setChatReferences(checked ? c.chat.referenceUrls.filter(url => url !== article.articleUrl) : [...c.chat.referenceUrls, article.articleUrl])} />
                <span className="min-w-0"><span className="block break-words text-sm font-medium">{article.headline}</span><span className="mt-1 block text-xs text-muted-foreground">{article.source}</span></span>
              </label>;
            })}
          </fieldset>
          <div className="flex items-center justify-between gap-2"><span className="text-sm">{c.chat.referenceUrls.length} selected</span><Button onClick={() => { setPanel(undefined); focusChat(); }}>Use selected articles</Button></div>
        </div>}
        {panel === "tone" && <div role="group" aria-label="Writing tone" className="grid gap-2 sm:grid-cols-2">{c.toneOptions.map(tone => <Button key={tone.key} variant={c.tone === tone.key ? "secondary" : "outline"} aria-pressed={c.tone === tone.key} disabled={locked} onClick={() => c.setTone(tone.key)}>{tone.label}</Button>)}</div>}
        {panel === "length" && <div role="group" aria-label="Draft length" className="grid gap-2 sm:grid-cols-2">
          <Button aria-pressed={c.requestedFormat === "short-post"} variant={c.requestedFormat === "short-post" ? "secondary" : "outline"} disabled={locked} onClick={() => c.setFormat("short-post")}>Short draft</Button>
          <Button aria-pressed={c.requestedFormat === "article"} variant={c.requestedFormat === "article" ? "secondary" : "outline"} disabled={locked} onClick={() => c.setFormat("article")}>Expanded article</Button>
        </div>}
        {panel === "platforms" && <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Use your reviewed document, including your edits. Choose up to four platforms.</p>
          {c.preferencesReady && !c.platforms.length && <p>No enabled platforms are available. Update your publishing preferences in Settings.</p>}
          <fieldset aria-label="Platforms to generate" disabled={locked} className="grid gap-2 sm:grid-cols-2">{c.platforms.map(platform => {
            const checked = c.selectedPlatforms.includes(platform.value);
            return <label key={platform.value} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-md border p-3 ${checked ? "border-primary bg-primary/5" : ""}`}>
              <input type="checkbox" checked={checked} disabled={!checked && c.selectedPlatforms.length >= 4} onChange={() => c.toggleSelectedPlatform(platform.value)} className="h-4 w-4 accent-primary" />{platform.label}
            </label>;
          })}</fieldset>
          <Button disabled={!c.canGenerateBatch} data-testid="button-generate-selected" onClick={() => { setPanel(undefined); void c.generateBatch(c.selectedPlatforms); }}><Sparkles className="h-4 w-4" />Create platform versions</Button>
        </div>}
        {panel === "link" && <div className="space-y-3">
          <Input aria-label="Article URL" type="url" value={link} onChange={event => setLink(event.target.value)} placeholder="https://publisher.com/article" />
          <p className="text-sm text-muted-foreground">Changing the source replaces the current creation only after your confirmation.</p>
          <Button disabled={locked || !publicSourceUrl(link.trim())} onClick={() => { if (c.setUrl(link.trim())) { setPanel(undefined); focusChat(); } }}><Plus className="h-4 w-4" />Use article link</Button>
        </div>}
        {panel === "notes" && (c.mode === "manual" ? <RichArticleEditor value={c.manual} onChange={c.setManual} isPending={locked} onUploadingChange={c.setUploading} />
          : <div className="space-y-3"><p className="text-sm text-muted-foreground">Use your notes as the source. Existing work is replaced only after confirmation.</p><Button onClick={() => c.setMode("manual")} disabled={locked}>Use notes as source</Button></div>)}
        {panel === "evidence" && (c.main?.review ? <div className="space-y-4"><SourceReview article={c.main.review.article} /><EditorialDetails evidence={c.main.review.evidence}
          detail={c.main.review.mainDraft} edited={c.main.content !== c.main.original} currentContent={c.main.content} /></div>
          : <p className="text-sm text-muted-foreground">This document has no applied AI generation yet. Your own text is not independently fact-checked.</p>)}
      </DialogContent>
    </Dialog>
  </div>;
}
