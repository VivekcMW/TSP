import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** No longer rendered; kept optional so existing callers don't need to change. */
  icon?: LucideIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned controls (buttons, filters) or stat chips. */
  actions?: ReactNode;
  /** Small metric chips rendered under the title, e.g. "12 active · 3 saved". */
  stats?: ReactNode;
  /** Match PageBody's contentClassName for narrower or full-width views. */
  contentClassName?: string;
}

// Shared chrome for every dashboard page header, so the app stops looking
// like four hand-rolled variants of the same icon+title+description block.
export function PageHeader({ title, subtitle, actions, stats, contentClassName }: Readonly<PageHeaderProps>) {
  return (
    <header className="dashboard-gutter dashboard-touch-targets sticky top-0 z-10 bg-background border-b py-4 shrink-0">
      <div className={cn("dashboard-container flex items-start justify-between gap-4 flex-wrap", contentClassName)}>
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="heading-dashboard break-words" data-testid="text-page-title">
            {title}
          </h1>
          {subtitle != null && <p className="mt-1 break-words text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}
          {stats != null && <div className="flex items-center gap-2 mt-2 flex-wrap tabular-nums">{stats}</div>}
        </div>
        {actions && <div className="flex w-full min-w-0 items-center gap-2 flex-wrap sm:w-auto">{actions}</div>}
      </div>
    </header>
  );
}

/** Optional page-body companion: shares PageHeader's width and responsive gutters. */
export function PageBody({ children, className, contentClassName, ...props }: Readonly<ComponentProps<"main"> & { contentClassName?: string }>) {
  return (
    <main className={cn("dashboard-gutter min-h-0 flex-1 overflow-y-auto py-4 sm:py-6", className)} {...props}>
      <div className={cn("dashboard-container", contentClassName)}>{children}</div>
    </main>
  );
}
