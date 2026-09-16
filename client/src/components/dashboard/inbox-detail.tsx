import { ExternalLink, Sparkles, Bookmark, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { InboxItem } from "@shared/schema";

interface InboxDetailProps {
  item: InboxItem;
  onGeneratePost: (item: InboxItem) => void;
  onSave: (item: InboxItem) => void;
  onDismiss: (item: InboxItem) => void;
}

/** Full reading + action view for whichever article is selected in Discover's triage list. Shared by the desktop split-pane and the mobile detail sheet. */
export function InboxDetail({ item, onGeneratePost, onSave, onDismiss }: Readonly<InboxDetailProps>) {
  const matchedKeywords = item.matchedKeywords || [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-xs">{item.source}</Badge>
            <span className="text-xs text-muted-foreground">{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "Today"}</span>
            <a
              href={item.articleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              data-testid={`link-article-${item.id}`}
            >
              <span>Open original</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <h2 className="heading-dashboard mb-3 text-xl leading-snug" data-testid={`text-headline-${item.id}`}>{item.headline}</h2>
          {matchedKeywords.length > 0 && (
            <p className="mb-4 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Why this is relevant:</span> matches {matchedKeywords.slice(0, 3).join(", ")}
            </p>
          )}
          {item.summary && <p className="mb-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{item.summary}</p>}
          {matchedKeywords.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {matchedKeywords.map((keyword) => (
                <Badge key={keyword} variant="outline" className="border-secondary/40 bg-secondary/5 text-xs font-normal text-secondary">{keyword}</Badge>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t p-4">
        <Button onClick={() => onGeneratePost(item)} data-testid={`button-generate-${item.id}`}>
          <Sparkles className="mr-2 h-4 w-4" />Generate Post
        </Button>
        <Button variant="outline" onClick={() => onSave(item)} disabled={item.status === "saved"} data-testid={`button-save-${item.id}`}>
          <Bookmark className="mr-2 h-4 w-4" />{item.status === "saved" ? "Saved" : "Save"}
        </Button>
        <Button variant="ghost" onClick={() => onDismiss(item)} data-testid={`button-dismiss-${item.id}`}>
          <X className="mr-2 h-4 w-4" />Dismiss
        </Button>
        <span className="ml-auto hidden text-xs text-muted-foreground lg:block">j/k navigate · s save · d dismiss · g generate</span>
      </div>
    </div>
  );
}
