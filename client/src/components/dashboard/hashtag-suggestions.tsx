import { suggestHashtags } from "@/lib/hashtag-suggestions";

/**
 * Presentational only: suggestions are derived purely from this post's own
 * generated text (repeated/capitalized terms already present), not fetched
 * trend data or an AI claim. Clicking a chip appends it; nothing is
 * inserted automatically.
 */
export function HashtagSuggestions({ content, platform, onAppend, disabled }: Readonly<{
  content: string; platform: string; onAppend: (tag: string) => void; disabled?: boolean;
}>) {
  const suggestions = suggestHashtags(content, platform);
  if (!suggestions.length) return null;
  return <div className="flex flex-wrap items-center gap-1.5">
    <span className="text-xs text-muted-foreground">Suggested tags, from this post's own text:</span>
    {suggestions.map(tag => <button key={tag} type="button" disabled={disabled} onClick={() => onAppend(tag)}
      className="min-h-11 rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
      data-testid={`button-suggest-hashtag-${tag.slice(1).toLowerCase()}`}>{tag}</button>)}
  </div>;
}
