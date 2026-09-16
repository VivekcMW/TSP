import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronUp, Copy, ExternalLink, Link2, Loader2, PenLine, Send } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getPlatformMeta, PLATFORMS } from "@/lib/platforms";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RichArticleEditor, type ArticleMedia } from "@/components/dashboard/rich-article-editor";
import type { InboxItem } from "@shared/schema";

interface InstantReviewResult {
  article: { title: string; source: string; url: string; domain: string; content: string; media?: ArticleMedia[] };
  posts: Record<string, Record<string, string>>;
}

interface InstantReviewPanelProps { isOpen: boolean; onClose: () => void; }

const TONES = [
  ["thoughtLeader", "Thought Leader", "professional"],
  ["industryInsider", "Industry Insider", "authoritative"],
  ["provocateur", "Provocateur", "contrarian"],
  ["dataDriven", "Data-Driven", "ai-recommended"],
] as const;

const PLATFORM_KEYWORDS: Record<string, string[]> = {
  linkedin: ["business", "leadership", "enterprise", "strategy", "work", "company"],
  twitter: ["news", "launch", "ai", "tech", "trend", "update"],
  reddit: ["discussion", "community", "question", "guide", "opensource"],
  devto: ["developer", "engineering", "code", "api", "software", "open source"],
  hashnode: ["developer", "engineering", "code", "api", "software", "open source"],
  medium: ["insight", "guide", "analysis", "opinion", "story"],
  substack: ["analysis", "newsletter", "opinion", "industry"],
};

function relevance(item: InboxItem, platform: string): number {
  const text = `${item.headline} ${item.summary ?? ""} ${item.source}`.toLowerCase();
  const keywords = PLATFORM_KEYWORDS[platform] ?? ["news", "industry", "business", "technology"];
  return keywords.reduce((score, keyword) => score + (text.includes(keyword) ? 1 : 0), 0);
}

function PostOption({ content, platform, tone, onSave, saving }: { content: string; platform: string; tone: readonly [string, string, string]; onSave: () => void; saving: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(content); setCopied(true); window.setTimeout(() => setCopied(false), 1600); };
  return <Card className="mb-3"><CardContent className="p-4 space-y-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{tone[1]}</p><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={copy}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button><Button size="sm" onClick={onSave} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save draft"}</Button></div></div><p className="whitespace-pre-wrap text-sm leading-relaxed">{content}</p></CardContent></Card>;
}

export function InstantReviewPanel({ isOpen, onClose }: InstantReviewPanelProps) {
  const { toast } = useToast();
  const [selectedPlatform, setSelectedPlatform] = useState("linkedin");
  const [result, setResult] = useState<InstantReviewResult | null>(null);
  const [resultPlatform, setResultPlatform] = useState("linkedin");
  const [url, setUrl] = useState("");
  const [writingArticle, setWritingArticle] = useState(false);
  const [width, setWidth] = useState(760);
  const resizing = useRef(false);
  const { data: inbox = [] } = useQuery<InboxItem[]>({ queryKey: ["/api/inbox"], enabled: isOpen });
  // Discovery remains available across every platform, even when a user has
  // hidden a platform from their normal post-generator preferences.
  const platforms = PLATFORMS;
  const articles = useMemo(() => inbox.slice().sort((a, b) => relevance(b, selectedPlatform) - relevance(a, selectedPlatform)), [inbox, selectedPlatform]);

  useEffect(() => {
    const move = (event: PointerEvent) => { if (resizing.current) setWidth(Math.max(460, Math.min(1100, window.innerWidth - event.clientX))); };
    const stop = () => { resizing.current = false; };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
  }, []);

  const reviewMutation = useMutation({
    mutationFn: async (url: string) => (await apiRequest("POST", "/api/instant-review/selected", { url, selectedPlatforms: [selectedPlatform] })).json() as Promise<InstantReviewResult>,
    onSuccess: (data) => { setResult(data); setResultPlatform(selectedPlatform); queryClient.invalidateQueries({ queryKey: ["/api/profile"] }); toast({ title: "Posts generated", description: `Your ${getPlatformMeta(selectedPlatform).label} options are ready.` }); },
    onError: (error: Error) => toast({ title: "Failed to generate review", description: error.message, variant: "destructive" }),
  });
  const manualReviewMutation = useMutation({
    mutationFn: async (article: { title: string; content: string; media: ArticleMedia[] }) => (await apiRequest("POST", "/api/instant-review/manual", { ...article, selectedPlatforms: [selectedPlatform] })).json() as Promise<InstantReviewResult>,
    onSuccess: (data) => { setResult(data); setWritingArticle(false); toast({ title: "Posts generated", description: "Choose a post option to save as a draft." }); },
    onError: (error: Error) => toast({ title: "Failed to analyze article", description: error.message, variant: "destructive" }),
  });
  const saveDraftMutation = useMutation({
    mutationFn: async (data: { platform: string; tone: string; content: string; media?: ArticleMedia[] }) => (await apiRequest("POST", "/api/drafts", data)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/drafts"] }); toast({ title: "Draft saved" }); },
    onError: () => toast({ title: "Could not save draft", variant: "destructive" }),
  });

  useEffect(() => { if (!platforms.some((platform) => platform.value === selectedPlatform)) setSelectedPlatform(platforms[0]?.value ?? "linkedin"); }, [platforms, selectedPlatform]);
  const close = () => { setResult(null); setWritingArticle(false); setUrl(""); onClose(); };
  const submitUrl = (event: React.FormEvent) => { event.preventDefault(); if (url.trim()) reviewMutation.mutate(url.trim()); };

  return <Sheet open={isOpen} onOpenChange={(open) => !open && close()}>
    <SheetContent side="right" className="flex h-dvh w-full !max-w-none flex-col gap-0 overflow-hidden p-0" style={{ width, maxWidth: "100vw" }}>
      <div className="absolute inset-y-0 left-0 z-20 hidden w-3 cursor-ew-resize bg-border/0 hover:bg-secondary/70 md:block" onPointerDown={(event) => { resizing.current = true; event.currentTarget.setPointerCapture(event.pointerId); }} data-testid="instant-review-resize-handle" />
      <SheetHeader className="border-b px-6 py-4 pr-14 text-left"><SheetTitle className="flex items-center gap-2"><Link2 className="h-5 w-5 text-secondary" />Instant Review</SheetTitle><SheetDescription>Select a platform, paste an article URL, or write your own article.</SheetDescription></SheetHeader>
      <form onSubmit={submitUrl} className="flex gap-2 border-b bg-muted/20 px-5 py-3"><Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Paste an article URL…" type="url" data-testid="input-instant-review-url" /><Button type="submit" size="sm" disabled={!url.trim() || reviewMutation.isPending}>{reviewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Review URL"}</Button><Button type="button" size="sm" variant="outline" onClick={() => { setWritingArticle(true); setResult(null); }}><PenLine className="mr-1.5 h-4 w-4" />Write article</Button></form>
      <div className="flex min-h-0 flex-1">
        <aside className="w-44 shrink-0 border-r bg-muted/30"><ScrollArea className="h-full"><nav className="space-y-1 p-2" aria-label="Platforms">{platforms.map((platform) => { const Icon = platform.icon; const count = inbox.filter((item) => relevance(item, platform.value) > 0).length; return <button key={platform.value} onClick={() => { setSelectedPlatform(platform.value); setResult(null); }} className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${selectedPlatform === platform.value ? "bg-secondary/15 text-foreground font-medium" : "text-muted-foreground hover:bg-muted"}`} data-testid={`instant-review-platform-${platform.value}`}><Icon className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{platform.label}</span><span className="text-xs">{count}</span></button>; })}</nav></ScrollArea></aside>
        <main className="min-w-0 flex-1">{writingArticle ? <RichArticleEditor onAnalyze={manualReviewMutation.mutate} isPending={manualReviewMutation.isPending} /> : result ? <ReviewResults result={result} platform={resultPlatform} onPlatform={setResultPlatform} onBack={() => setResult(null)} saveDraft={saveDraftMutation.mutate} saving={saveDraftMutation.isPending} /> : <ArticleList platform={selectedPlatform} articles={articles} onReview={(article) => reviewMutation.mutate(article.articleUrl)} pending={reviewMutation.isPending} />}</main>
      </div>
    </SheetContent>
  </Sheet>;
}

function ArticleList({ platform, articles, onReview, pending }: { platform: string; articles: InboxItem[]; onReview: (article: InboxItem) => void; pending: boolean }) {
  const meta = getPlatformMeta(platform);
  return <div className="flex h-full min-h-0 flex-col"><div className="border-b px-5 py-4"><h3 className="font-medium">Articles for {meta.label}</h3><p className="text-sm text-muted-foreground">Ranked by relevance for this platform’s audience.</p></div><ScrollArea className="min-h-0 flex-1"><div className="space-y-3 p-5">{pending ? <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Generating review…</div> : articles.length ? articles.map((article) => <Card key={article.id}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{article.source}</p><h4 className="mt-1 font-medium leading-snug">{article.headline}</h4>{article.summary && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{article.summary}</p>}<Button className="mt-3" size="sm" onClick={() => onReview(article)}><Send className="mr-1.5 h-3.5 w-3.5" />Review article</Button></CardContent></Card>) : <p className="py-10 text-center text-sm text-muted-foreground">No inbox articles yet. Refresh your Inbox to find relevant articles.</p>}</div></ScrollArea></div>;
}

function ReviewResults({ result, platform, onPlatform, onBack, saveDraft, saving }: { result: InstantReviewResult; platform: string; onPlatform: (platform: string) => void; onBack: () => void; saveDraft: (data: { platform: string; tone: string; content: string; media?: ArticleMedia[] }) => void; saving: boolean }) {
  return <div className="flex h-full min-h-0 flex-col"><div className="border-b p-5"><Button variant="ghost" size="sm" onClick={onBack}>← All articles</Button><h3 className="mt-2 font-medium">{result.article.title}</h3><SourceContent article={result.article} /><Tabs value={platform} onValueChange={onPlatform}><TabsList className="mt-3">{Object.keys(result.posts).map((key) => <TabsTrigger key={key} value={key}>{getPlatformMeta(key).label}</TabsTrigger>)}</TabsList></Tabs></div><ScrollArea className="min-h-0 flex-1"><div className="p-5">{TONES.map((tone) => <PostOption key={tone[0]} content={result.posts[platform]?.[tone[0]] ?? ""} platform={platform} tone={tone} saving={saving} onSave={() => saveDraft({ platform, tone: tone[2], content: result.posts[platform]?.[tone[0]] ?? "", media: result.article.media })} />)}</div></ScrollArea></div>;
}

/** Shows exactly what was crawled from the URL (or written manually) — the real basis for the AI's posts, not just the headline, so a user can verify the source content the moment something looks off. */
function SourceContent({ article }: { article: InstantReviewResult["article"] }) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = Boolean(article.content?.trim());
  return <div className="mt-2 space-y-2">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {article.source && <span>{article.source}</span>}
      {article.domain && article.domain !== "manual" && <span>· {article.domain}</span>}
      {article.url && <a href={article.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-secondary hover:underline">Open original<ExternalLink className="h-3 w-3" /></a>}
    </div>
    {hasContent && <div className="rounded-md border bg-muted/20 p-3">
      <button type="button" onClick={() => setExpanded((current) => !current)} className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground" data-testid="button-toggle-source-content">
        <span>Fetched article content</span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      <p className={`mt-2 whitespace-pre-wrap text-sm leading-relaxed ${expanded ? "" : "line-clamp-3"}`} data-testid="text-source-content">{article.content}</p>
    </div>}
  </div>;
}
