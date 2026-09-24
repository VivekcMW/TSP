import type { ReactNode } from "react";
import { Hash, Newspaper, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PreviewHeadline } from "@/lib/onboarding-suggestions";

interface SetupCanvasProps {
  className?: string;
  view: "empty" | "setup" | "finished";
  count: number;
  canFinish: boolean;
  isPending: boolean;
  onFinish: () => void;
  /** The three sections, when there is a setup to show. */
  children?: ReactNode;
  finished?: {
    summary: string;
    preview: { status: "idle" | "loading" | "ready" | "empty"; headlines: PreviewHeadline[]; hasTopics: boolean };
    onWritePost: (headline: PreviewHeadline) => void;
    onOpenDiscover: () => void;
    onOpenDashboard: () => void;
  };
}

const PLACEHOLDERS = [
  { icon: Newspaper, title: "Sources", text: "Publications covering your focus this month" },
  { icon: Hash, title: "Topics", text: "What those publications are writing about right now" },
  { icon: Users, title: "People and companies", text: "Named in those headlines, with the reason for each" },
];

/** "Your setup": empty until Pundit builds it (or you add your own), then the finish view. */
export function SetupCanvas({ className, view, count, canFinish, isPending, onFinish, children, finished }: Readonly<SetupCanvasProps>) {
  if (view === "finished" && finished) {
    const { preview } = finished;
    return (
      <section aria-label="Your setup" className={cn("min-h-0 flex-col overflow-y-auto bg-background px-4 py-6 sm:px-8", className)}>
        <div className="mx-auto w-full max-w-3xl space-y-5">
          <div>
            <h1 className="font-heading text-2xl font-semibold">Your Discover is ready</h1>
            <p className="mt-1 text-sm text-muted-foreground">{finished.summary}</p>
          </div>
          <section aria-label="Discover preview" className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">In your feed today</p>
            {preview.status === "loading" && <p role="status" className="animate-pulse text-sm text-muted-foreground">Finding recent articles on your topics…</p>}
            {preview.status === "empty" && (
              <p className="text-sm text-muted-foreground">{preview.hasTopics ? "Discover fills in the first time you refresh it." : "Pick a few topics in Settings so Discover knows what to look for."}</p>
            )}
            {preview.status === "ready" && (
              <ul className="space-y-3">
                {preview.headlines.map(headline => (
                  <li key={headline.title} className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      {headline.link
                        ? <a href={headline.link} target="_blank" rel="noopener noreferrer" className="font-medium leading-snug hover:underline [overflow-wrap:anywhere]">{headline.title}</a>
                        : <span className="font-medium leading-snug">{headline.title}</span>}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[headline.source, headline.publishedAt ? new Date(headline.publishedAt).toLocaleDateString() : "", `on ${headline.topic}`].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {headline.link && (
                      <Button type="button" variant="outline" className="min-h-11 shrink-0" aria-label={`Write a post about ${headline.title}`} onClick={() => finished.onWritePost(headline)}>
                        Write a post
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <div className="flex flex-col gap-3 sm:flex-row [&_button]:min-h-11">
            <Button type="button" onClick={finished.onOpenDiscover}>Open Discover</Button>
            <Button type="button" variant="outline" onClick={finished.onOpenDashboard}>Go to dashboard</Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Your setup" className={cn("min-h-0 flex-col overflow-y-auto bg-background px-4 py-6 sm:px-8", className)}>
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-semibold">Your setup</h1>
            <p className="text-sm text-muted-foreground">
              {view === "empty" ? "Pundit fills this in from live news, and you stay in control of every pick." : `${count} selected. Keep what fits, remove the rest, or add your own.`}
            </p>
          </div>
          <Button type="button" className="min-h-11" onClick={onFinish} disabled={!canFinish || isPending} data-testid="button-complete-onboarding">
            {isPending ? "Saving…" : "Finish setup"}
          </Button>
        </div>
        {view === "empty" ? (
          <div className="space-y-3">
            {PLACEHOLDERS.map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex items-center gap-4 rounded-xl border border-dashed bg-card p-5">
                <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"><Icon className="h-5 w-5" /></span>
                <div><p className="font-medium">{title}</p><p className="text-sm text-muted-foreground">{text}</p></div>
              </div>
            ))}
            <p className="text-sm text-muted-foreground">{canFinish ? "Check what Pundit understood, then build your setup." : "Tell Pundit about your work to begin."}</p>
          </div>
        ) : children}
      </div>
    </section>
  );
}
