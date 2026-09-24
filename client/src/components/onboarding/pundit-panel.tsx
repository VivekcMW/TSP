import { useEffect, useRef, type ReactNode } from "react";
import { Check, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PanelChip { label: string; onClick: () => void; primary?: boolean; disabled?: boolean }
export type PanelMessage =
  | { id: number; from: "pundit"; text: string; chips?: PanelChip[] }
  | { id: number; from: "user"; text: string; about?: string }
  | { id: number; from: "pundit"; card: ReactNode };
export interface ProgressItem { label: string; state: "done" | "running" | "waiting" | "error"; detail: string }

interface PunditPanelProps {
  className?: string;
  messages: PanelMessage[];
  thinking?: string;
  progress?: ProgressItem[];
  log: string[];
}

export function PunditAvatar({ size = 32 }: { size?: number }) {
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center justify-center rounded-full bg-primary" style={{ width: size, height: size }}>
      <Zap className="text-secondary fill-secondary" style={{ width: size / 2, height: size / 2 }} />
    </span>
  );
}

function StatusIcon({ state }: { state: ProgressItem["state"] }) {
  if (state === "done") return <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground"><Check className="h-3 w-3" strokeWidth={3} /></span>;
  if (state === "running") return <span aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin rounded-full border-[2.5px] border-primary border-t-secondary" />;
  if (state === "error") return <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive text-xs font-bold text-destructive-foreground">!</span>;
  return <span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-full border-2 border-input" />;
}

/** Pundit's side of the workspace: the conversation, its progress and what it did. */
export function PunditPanel({ className, messages, thinking, progress, log }: Readonly<PunditPanelProps>) {
  // Keep the newest message in view, as in any conversation.
  const scroller = useRef<HTMLDivElement>(null);
  const newest = messages.at(-1)?.id;
  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [newest, thinking]);
  return (
    <section aria-label="Pundit" className={cn("min-h-0 flex-col bg-card lg:border-r", className)}>
      <div className="flex items-center gap-3 border-b px-5 py-4">
        <PunditAvatar size={40} />
        <div>
          <h2 className="font-heading text-base font-semibold">Pundit</h2>
          <p className="text-sm text-muted-foreground">Your setup agent</p>
        </div>
      </div>
      {progress && (
        <div className="shrink-0 space-y-1.5 border-b px-5 py-3">
          <ol aria-label="Pundit's progress" className="space-y-1.5">
            {progress.map(item => (
              <li key={item.label} className="flex min-w-0 items-center gap-2.5 text-sm">
                <StatusIcon state={item.state} />
                <span className={cn("shrink-0 font-medium", item.state === "waiting" && "text-muted-foreground")}>{item.label}</span>
                <span className="min-w-0 truncate text-muted-foreground" title={item.detail}>{item.detail}</span>
              </li>
            ))}
          </ol>
          {log.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Show what I did</summary>
              <ol className="mt-1 max-h-40 list-decimal space-y-0.5 overflow-y-auto pl-5">{log.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol>
            </details>
          )}
        </div>
      )}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <ol aria-label="Conversation" aria-live="polite" className="space-y-4">
          {messages.map(message => {
            if (message.from === "user") {
              return (
                <li key={message.id} className="flex flex-col items-end gap-1">
                  <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground [overflow-wrap:anywhere]">{message.text}</p>
                  {message.about && <span className="text-xs text-muted-foreground">About {message.about}</span>}
                </li>
              );
            }
            return (
              <li key={message.id} className="flex gap-3">
                <PunditAvatar />
                <div className="min-w-0 flex-1 space-y-2">
                  {"card" in message ? message.card : <p className="text-sm leading-relaxed [overflow-wrap:anywhere]">{message.text}</p>}
                  {"chips" in message && message.chips && message.chips.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {message.chips.map(chip => (
                        <Button key={chip.label} type="button" size="sm" variant={chip.primary ? "default" : "outline"} disabled={chip.disabled}
                          className="h-auto min-h-9 rounded-full px-3.5 py-1.5" onClick={chip.onClick}>{chip.label}</Button>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
          {thinking && (
            <li className="flex items-center gap-3 text-sm text-muted-foreground" role="status">
              <PunditAvatar /><span className="animate-pulse">{thinking}</span>
            </li>
          )}
        </ol>
      </div>
    </section>
  );
}
