import { ExternalLink, Sparkles, Bookmark, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SheetTitle } from "@/components/ui/sheet";
import type { InboxItem } from "@shared/schema";
import { articleDateLabel } from "@/lib/article-date-label";
import { relevanceSummary } from "@/lib/relevance-summary";

interface InboxDetailProps {
  item: InboxItem;
  onGeneratePost: (item: InboxItem) => void;
  onSave: (item: InboxItem) => void;
  onDismiss: (item: InboxItem) => void;
  /** Enable inside SheetContent to register the visible headline as its title. */
  inSheet?: boolean;
  /** Alternative aria-labelledby target when the owner supplies dialog semantics. */
  titleId?: string;
}

/** Full reading + action view for whichever article is selected in Discover's triage list. Shared by the desktop split-pane and the mobile detail sheet. */
export function InboxDetail({ item, onGeneratePost, onSave, onDismiss, inSheet = false, titleId }: Readonly<InboxDetailProps>) {
  const matchedKeywords = item.matchedKeywords || [];
  const relevanceReason = relevanceSummary(item);
  const headline = <h2 {...(!inSheet && titleId ? { id: titleId } : {})} className="heading-dashboard mb-3 break-words text-xl leading-snug" data-testid={`text-headline-${item.id}`}>{item.headline}</h2>;
  let excerptLabel = "Saved excerpt (legacy provenance unavailable)";
  if (item.qualityMetadata?.summary?.method === "extractive") excerptLabel = "Article excerpt";
  if (item.qualityMetadata?.summary?.method === "source_excerpt") excerptLabel = "Source excerpt (feed or provider snippet)";

  return (
    <div className="dashboard-touch-targets flex h-full min-h-0 min-w-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-2xl">
          <div className={`mb-3 flex flex-wrap items-center gap-2 ${inSheet ? "pr-10" : ""}`}>
            <Badge variant="secondary" className="max-w-full break-words text-xs">{item.source}</Badge>
            <span className="text-xs tabular-nums text-muted-foreground">{articleDateLabel(item)}</span>
            <a
              href={item.articleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
              data-testid={`link-article-${item.id}`}
            >
              <span>Open original</span>
              <span className="sr-only"> (opens in a new tab)</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
          {inSheet ? <SheetTitle asChild>{headline}</SheetTitle> : headline}
          {relevanceReason && (
            <p className="mb-4 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Why this is relevant:</span> {relevanceReason}
            </p>
          )}
          {item.summary ? <section aria-label="Article excerpt" className="mb-4">
            <p className="mb-1 text-xs font-medium text-muted-foreground">{excerptLabel} · Not independently verified</p>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">{item.summary}</p>
          </section> : <p className="mb-4 text-sm text-muted-foreground">Excerpt unavailable. Open the original for context.</p>}
          {matchedKeywords.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {matchedKeywords.map((keyword) => (
                <Badge key={keyword} variant="outline" className="max-w-full break-words border-secondary/40 bg-secondary/5 text-xs font-normal text-secondary">{keyword}</Badge>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 border-t p-4 sm:px-6">
      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        <Button onClick={() => onGeneratePost(item)} data-testid={`button-generate-${item.id}`}>
          <Sparkles className="mr-2 h-4 w-4" />Create draft
        </Button>
        <Button variant="outline" onClick={() => onSave(item)} disabled={item.status === "saved"} data-testid={`button-save-${item.id}`}>
          <Bookmark className="mr-2 h-4 w-4" />{item.status === "saved" ? "Story saved" : "Save story"}
        </Button>
        <Button variant="outline" onClick={() => onDismiss(item)} data-testid={`button-dismiss-${item.id}`}>
          <X className="mr-2 h-4 w-4" />Dismiss
        </Button>
      </div>
      </div>
    </div>
  );
}
