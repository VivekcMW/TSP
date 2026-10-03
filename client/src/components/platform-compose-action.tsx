import { useId, useLayoutEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getPlatformMeta } from "@/lib/platforms";
import { copyAndOpenPlatform, type PlatformHandoffResult } from "@/lib/platform-handoff";
import { platformTextValidation } from "@shared/editorial";

export function PlatformComposeAction({ platform, text, testId, disabled = false, canProceed, onBusyChange }: Readonly<{
  platform: string;
  text: string;
  testId?: string;
  disabled?: boolean;
  /** Read live safety/identity refs; the admission callback also owns completion. */
  canProceed?: () => boolean;
  /** Synchronous admission; one matching release on settlement or invalidation. */
  onBusyChange?: (busy: boolean) => void;
}>) {
  const meta = getPlatformMeta(platform);
  const descriptionId = useId();
  const mounted = useRef(false);
  const active = useRef<{ finish: () => void }>();
  const callbacks = useRef({ canProceed, onBusyChange });
  callbacks.current = { canProceed, onBusyChange };
  // A new context invalidates copy feedback, even if text later returns to an
  // earlier value. Late clipboard results cannot restore stale recovery links.
  const context = useRef({ platform, text, disabled });
  if (context.current.platform !== platform || context.current.text !== text || context.current.disabled !== disabled) context.current = { platform, text, disabled };
  const currentContext = context.current;
  const [pendingContext, setPendingContext] = useState<typeof currentContext>();
  const pending = pendingContext === currentContext;
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Release the original owner's busy ref now. Its eventual finally must
      // neither release a newer operation nor write state after unmount.
      active.current?.finish();
    };
  }, [currentContext]);
  const [attempt, setAttempt] = useState<{ context: typeof currentContext; result: PlatformHandoffResult }>();
  const result = !disabled && attempt?.context === currentContext ? attempt.result : undefined;
  const valid = !platformTextValidation(text, platform, meta.charLimit).error;
  const destination = meta.composeUrl(text);

  function ownsContext() {
    if (!mounted.current || context.current !== currentContext || disabled || !valid) return false;
    try {
      // Retain the admission guard (it can capture a draft/revision identity)
      // AND consult the latest guard for live safety changes without text edits.
      return (canProceed?.() ?? true) && (callbacks.current.canProceed === canProceed || (callbacks.current.canProceed?.() ?? true));
    } catch { return false; }
  }

  async function open() {
    if (active.current || !ownsContext()) return;
    const notifyBusy = callbacks.current.onBusyChange;
    let finished = false;
    const operation = { finish: () => {
      if (finished) return;
      finished = true;
      if (active.current === operation) {
        active.current = undefined;
        if (mounted.current && context.current === currentContext) setPendingContext(undefined);
      }
      notifyBusy?.(false);
    } };
    active.current = operation;
    setAttempt(undefined);
    setPendingContext(currentContext);
    const ownsOperation = () => active.current === operation && ownsContext();
    try {
      // Synchronous: a sibling direct-publish action can check its ref before
      // React renders the disabled button or clipboard permission resolves.
      notifyBusy?.(true);
      const result = await copyAndOpenPlatform(text, destination, ownsOperation);
      if (ownsOperation() && result !== "abandoned") setAttempt({ context: currentContext, result });
    } finally {
      operation.finish();
    }
  }

  return <>
    <Button type="button" size="sm" variant="outline" className="text-left" disabled={disabled || pending || !valid} onClick={() => void open()} aria-describedby={descriptionId} data-testid={testId}>
      {pending ? "Copying…" : `Copy & open ${meta.label}`}<ExternalLink className="h-3.5 w-3.5" />
    </Button>
    <div className="min-w-0 basis-full space-y-2 text-xs text-muted-foreground">
      <p id={descriptionId}>{platform === "linkedin"
        ? "LinkedIn may not prefill text. Your full post is copied first; paste it if the composer is blank."
        : "Copies your full post, including its links and hashtags. Paste it if the platform does not prefill it."} Review and publish there yourself. Media must be attached there separately.</p>
      {result === "opened" && <output className="block">Post text copied. Opening {meta.label}; paste if needed, then review and publish. Nothing is marked as published here.</output>}
      {result === "open-failed" && <output className="block">Post text copied, but the new tab could not be opened. <a className="control-touch-target inline-flex min-h-8 min-w-8 items-center text-primary underline" href={destination} target="_blank" rel="noopener noreferrer" onClick={event => { if (!ownsContext()) event.preventDefault(); }} onAuxClick={event => { if (!ownsContext()) event.preventDefault(); }}>Continue to {meta.label}</a>, then paste and publish yourself.</output>}
      {result === "copy-failed" && <div role="alert" className="space-y-2 text-destructive">
        <p>Copy failed. No platform was opened. Select and copy the full text below, then continue.</p>
        <Textarea aria-label={`Text to copy for ${meta.label}`} readOnly value={text} onFocus={event => event.target.select()} className="min-h-32 text-foreground" />
        <a className="control-touch-target inline-flex min-h-8 min-w-8 items-center text-primary underline" href={destination} target="_blank" rel="noopener noreferrer" onClick={event => { if (!ownsContext()) event.preventDefault(); }} onAuxClick={event => { if (!ownsContext()) event.preventDefault(); }}>Continue to {meta.label} after copying</a>
      </div>}
    </div>
  </>;
}