import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Sparkles } from "lucide-react";

export function useProposalReveal(id: string | undefined, text: string) {
  const reducedMotion = useReducedMotion();
  const characters = useMemo(() => Array.from(text), [text]);
  const [progress, setProgress] = useState<{ id?: string; count: number }>({ count: 0 });
  const [skipped, setSkipped] = useState<string>();
  const count = progress.id === id ? progress.count : 0;
  const typing = Boolean(id && !reducedMotion && skipped !== id && count < characters.length);
  useEffect(() => {
    if (!id || reducedMotion || skipped === id) return;
    let frame: number;
    let start: number | undefined;
    const duration = Math.min(2200, Math.max(600, characters.length * 4));
    const tick = (now: number) => {
      start ??= now;
      const count = Math.min(characters.length, Math.ceil(characters.length * (now - start) / duration));
      setProgress({ id, count });
      if (count < characters.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [id, characters, reducedMotion, skipped]);
  return { typing, text: typing ? characters.slice(0, count).join("") : text, showAll: () => setSkipped(id) };
}

export function PunditWriting({ preview = false }: Readonly<{ preview?: boolean }>) {
  return <div role="status" aria-label="Pundit writing status" className={preview ? "space-y-5 rounded-sm border border-primary/30 bg-card p-5 shadow-sm" : "mb-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2"}>
    <div className="flex items-center gap-2 text-sm">
      <Sparkles className="h-4 w-4 text-primary motion-safe:animate-pulse" />
      <span className="font-medium">Pundit is writing</span>
      <span aria-hidden="true" className="ml-1 inline-flex gap-1">{[0, 150, 300].map(delay => <span key={delay} className="h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-bounce" style={{ animationDelay: `${delay}ms` }} />)}</span>
    </div>
    {preview && <>
      <p className="text-xs text-muted-foreground">Preparing your suggestion. Your document stays unchanged.</p>
      <div aria-hidden="true" className="space-y-4 py-4 motion-safe:animate-pulse">
        <div className="h-3 w-4/5 rounded bg-primary/10" /><div className="h-3 w-full rounded bg-muted" />
        <div className="h-3 w-11/12 rounded bg-muted" /><div className="h-3 w-3/5 rounded bg-muted" />
        <div className="h-3 w-full rounded bg-muted" /><div className="h-3 w-2/3 rounded bg-muted" />
      </div>
    </>}
  </div>;
}
