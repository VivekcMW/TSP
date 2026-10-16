import { Link } from "wouter";
import { ArrowRight } from "lucide-react";

export function AnnouncementBar() {
  return (
    <div className="border-b border-primary/20 bg-accent text-accent-foreground" data-testid="announcement-bar">
      <Link href="/how-it-works" className="mx-auto flex min-h-10 max-w-7xl items-center justify-center gap-2 px-4 py-2 text-center text-sm font-medium hover:underline">
        <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold tracking-[0.12em] text-primary-foreground">NEW</span>
        <span className="sm:hidden">Meet Pundit: your industry feed in a minute</span>
        <span className="hidden sm:inline">Meet Pundit: from one sentence to your personal industry intelligence feed</span>
        <ArrowRight className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true" />
      </Link>
    </div>
  );
}
