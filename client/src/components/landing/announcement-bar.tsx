import { Link } from "wouter";
import { ArrowRight } from "lucide-react";

/** One-line news above the header, the way large product sites announce what's new. */
export function AnnouncementBar() {
  return (
    <div className="border-b bg-card text-card-foreground" data-testid="announcement-bar">
      <Link href="/how-it-works" className="mx-auto flex min-h-10 max-w-7xl items-center justify-center gap-2 px-4 py-2 text-center text-sm hover:underline">
        <span className="rounded bg-info-subtle px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-info">NEW</span>
        <span>Pundit, your AI setup agent, builds your news feed in about a minute</span>
        <ArrowRight className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true" />
      </Link>
    </div>
  );
}
