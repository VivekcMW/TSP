import { Bookmark } from "lucide-react";
import type { InboxItem } from "@shared/schema";

const AVATAR_PALETTE = [
  "bg-primary/15 text-primary",
  "bg-secondary/20 text-secondary",
  "bg-success/15 text-success",
  "bg-brand-linkedin/15 text-brand-linkedin",
  "bg-destructive/10 text-destructive",
];

function avatarClassFor(source: string): string {
  let hash = 0;
  for (let i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function relativeTime(date: Date | string | null | undefined): string {
  if (!date) return "";
  const parsed = typeof date === "string" ? new Date(date) : date;
  const diffHrs = Math.floor((Date.now() - parsed.getTime()) / 3600000);
  if (diffHrs < 1) return "Just now";
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return parsed.toLocaleDateString();
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
      className={`flex w-full items-start gap-3 border-l-2 px-3 py-3 text-left transition-colors ${
        isActive ? "border-secondary bg-secondary/5" : "border-transparent hover-elevate"
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
          <span className="shrink-0">{relativeTime(item.createdAt)}</span>
          {matchedKeywords[0] && (
            <>
              <span>·</span>
              <span className="truncate text-secondary">{matchedKeywords[0]}</span>
            </>
          )}
        </div>
      </div>
      {isSaved && <Bookmark className="mt-1 h-3.5 w-3.5 shrink-0 fill-secondary text-secondary" aria-label="Saved" />}
    </button>
  );
}
