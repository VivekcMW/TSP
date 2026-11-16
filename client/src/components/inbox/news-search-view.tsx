/** Phase 3A owns this: keyword news search results with a reading pane. */
export function NewsSearchView({ query }: Readonly<{ query: string; savedId: string | null }>) {
  return <main className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground" aria-label="News search">News search for “{query}” is coming soon.</main>;
}
