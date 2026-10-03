import { Bookmark, Check } from "lucide-react";
import type { InboxItem } from "@shared/schema";
import { articleDateLabel } from "@/lib/article-date-label";

const AVATAR_PALETTE = [
  "bg-primary/15 text-primary",
  "bg-accent text-accent-foreground",
  "bg-success/15 text-success",
  "bg-brand-linkedin/15 text-brand-linkedin",
  "bg-destructive/10 text-destructive",
];

function avatarClassFor(source: string): string {
  let hash = 0;
  for (let i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

interface InboxListRowProps {
  item: InboxItem;
  isActive: boolean;
  onSelect: () => void;
}

/** Compact, scannable row for the Discover triage list — dense on purpose so a user can skim many candidates fast before deciding. */
export function InboxListRow({ item, isActive, onSelect }: Readonly<InboxListRowProps>) {
  const matchedKeywords = item.matchedKeywords || [];
  const isSaved = item.status === "saved";

  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`row-inbox-${item.id}`}
      aria-current={isActive}
      className={`flex w-full items-start gap-3 border-l-2 px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
        isActive ? "border-primary bg-accent text-foreground" : "border-transparent hover-elevate"
      }`}
    >
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarClassFor(item.source)}`}>
        {item.source.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium leading-snug">{item.headline}</p>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="max-w-[110px] truncate">{item.source}</span>
          <span>·</span>
          <span className="truncate" title={articleDateLabel(item)}>{articleDateLabel(item)}</span>
          {matchedKeywords[0] && (
            <>
              <span>·</span>
              <span className="truncate text-accent-foreground">{matchedKeywords[0]}</span>
            </>
          )}
        </div>
      </div>
      {(isActive || isSaved) && <div className="mt-1 flex shrink-0 flex-col gap-1 text-accent-foreground">
        {isActive && <Check className="h-4 w-4" aria-hidden="true" data-inbox-selected-marker="" />}
        {isSaved && <Bookmark className="h-3.5 w-3.5 fill-current" aria-label="Saved" />}
      </div>}
    </button>
  );
}
