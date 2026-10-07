import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PunditWriting({ elapsed, cancel }: Readonly<{ elapsed: number; cancel: () => void }>) {
  return <div role="status" aria-label="Pundit writing status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
    <div className="flex items-center gap-2 text-sm">
      <Sparkles className="h-4 w-4 text-primary motion-safe:animate-pulse" />
      <span className="font-medium">Pundit is writing in your document</span>
      <span aria-hidden="true" className="ml-1 inline-flex gap-1">{[0, 150, 300].map(delay => <span key={delay} className="h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-bounce" style={{ animationDelay: `${delay}ms` }} />)}</span>
    </div>
    <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{elapsed}s</span><Button size="sm" variant="ghost" onClick={cancel}>Cancel generation</Button></div>
  </div>;
}
