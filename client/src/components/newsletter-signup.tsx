import { useId, useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { newsletterSignup, type NEWSLETTER_SOURCES } from "@shared/newsletter";

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; message: string } | { kind: "error"; message: string };
const TRY_AGAIN = "We couldn't sign you up just now. Please try again in a few minutes.";

/** Email sign-up for the monthly newsletter; the server emails a confirmation link (double opt-in). */
export function NewsletterSignup({ source, tone = "light" }: { source: typeof NEWSLETTER_SOURCES[number]; tone?: "light" | "dark" }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = newsletterSignup.safeParse({ email, source });
    if (!parsed.success) return setStatus({ kind: "error", message: "Enter a valid email address." });
    setStatus({ kind: "sending" });
    try {
      const response = await fetch("/api/public/newsletter", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (response.status === 202) return setStatus({ kind: "sent", message: body.message ?? "Check your inbox and click the link to confirm your subscription." });
      setStatus({ kind: "error", message: response.status === 400 ? "Enter a valid email address." : body.message ?? TRY_AGAIN });
    } catch {
      setStatus({ kind: "error", message: TRY_AGAIN });
    }
  }

  const muted = tone === "dark" ? "text-surface-ink-foreground/75" : "text-muted-foreground";
  if (status.kind === "sent") {
    return (
      <p role="status" className="flex items-start gap-3 rounded-xl border bg-card p-4 text-sm font-medium text-foreground">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />{status.message}
      </p>
    );
  }
  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={id} className="sr-only">Email address</label>
        <input id={id} type="email" autoComplete="email" inputMode="email" placeholder="you@company.com" value={email}
          onChange={event => { setEmail(event.target.value); if (status.kind === "error") setStatus({ kind: "idle" }); }}
          aria-invalid={status.kind === "error"} aria-describedby={`${id}-note`}
          className="min-h-12 w-full flex-1 rounded-md border bg-background px-4 text-base text-foreground placeholder:text-muted-foreground" />
        <Button type="submit" className="h-12 px-6 text-base" disabled={status.kind === "sending"}>
          {status.kind === "sending" ? "Subscribing…" : "Subscribe"}
        </Button>
      </div>
      {status.kind === "error" && <p role="alert" className="text-sm font-medium text-destructive">{status.message}</p>}
      <p id={`${id}-note`} className={`text-xs ${muted}`}>
        We'll email you a link to confirm first. Unsubscribe any time. See our{" "}
        <a href="/privacy" className="underline underline-offset-2">Privacy Policy</a>.
      </p>
    </form>
  );
}
