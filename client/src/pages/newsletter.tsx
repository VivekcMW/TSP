import { useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { NewsletterSignup } from "@/components/newsletter-signup";
import { NEWSLETTER_PROMISE } from "@shared/newsletter";

type Action = "confirm" | "unsubscribe";
const COPY: Record<Action, { title: string; body: string; button: string; done: string; doneBody: string }> = {
  confirm: { title: "Confirm your subscription", body: NEWSLETTER_PROMISE, button: "Confirm subscription",
    done: "You're subscribed", doneBody: "Thanks. Your first email arrives with our next monthly issue." },
  unsubscribe: { title: "Unsubscribe from the newsletter", body: "You'll stop getting our monthly email. You can sign up again any time.", button: "Unsubscribe",
    done: "You're unsubscribed", doneBody: "You won't get the newsletter any more. Changed your mind? Sign up again below." },
};

function readLink(): { action: Action; token: string } | null {
  const params = new URLSearchParams(window.location.search);
  for (const action of ["confirm", "unsubscribe"] as const) {
    const token = params.get(action);
    if (token) return { action, token };
  }
  return null;
}

/**
 * Where confirmation and unsubscribe emails lead. Nothing happens until the button is pressed:
 * email security scanners open links automatically and must not subscribe or unsubscribe anyone.
 */
export default function NewsletterPage() {
  const [link] = useState(readLink);
  const [state, setState] = useState<"ready" | "working" | "done" | "failed">("ready");
  const [message, setMessage] = useState("");

  async function act() {
    if (!link) return;
    setState("working");
    try {
      const response = await fetch(`/api/public/newsletter/${link.action}`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: link.token }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (response.ok) return setState("done");
      setMessage(body.message ?? "Something went wrong. Please try the link again in a few minutes.");
      setState("failed");
    } catch {
      setMessage("Something went wrong. Please try the link again in a few minutes.");
      setState("failed");
    }
  }

  const copy = link ? COPY[link.action] : null;
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEO title="Newsletter" canonical="/newsletter" description={NEWSLETTER_PROMISE} />
      <SiteHeader />
      <main className="flex flex-1 items-start justify-center px-4 py-16 sm:px-6 lg:py-24">
        <div className="w-full max-w-xl space-y-6 rounded-2xl border bg-card p-7 sm:p-10">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary text-primary-foreground">
            {state === "done" ? <CheckCircle2 className="h-6 w-6" aria-hidden="true" /> : <Mail className="h-6 w-6" aria-hidden="true" />}
          </span>
          {copy && state === "done" ? (
            <div className="space-y-3" role="status">
              <h1 className="font-heading text-3xl font-semibold text-foreground">{copy.done}</h1>
              <p className="text-muted-foreground">{copy.doneBody}</p>
              {link?.action === "unsubscribe" ? <NewsletterSignup source="newsletter-page" /> : (
                <Button asChild variant="outline" className="min-h-11"><Link href="/">Back to TheSocialPundit</Link></Button>
              )}
            </div>
          ) : copy ? (
            <div className="space-y-4">
              <h1 className="font-heading text-3xl font-semibold text-foreground">{copy.title}</h1>
              <p className="text-muted-foreground">{copy.body}</p>
              {state === "failed" ? (
                <>
                  <p role="alert" className="font-medium text-destructive">{message}</p>
                  <p className="text-sm text-muted-foreground">Sign up again to get a fresh link:</p>
                  <NewsletterSignup source="newsletter-page" />
                </>
              ) : (
                <Button className="min-h-11" disabled={state === "working"} onClick={act}>{state === "working" ? "One moment…" : copy.button}</Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <h1 className="font-heading text-3xl font-semibold text-foreground">The TheSocialPundit newsletter</h1>
              <p className="text-muted-foreground">{NEWSLETTER_PROMISE}</p>
              <NewsletterSignup source="newsletter-page" />
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
