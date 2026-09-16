import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface PageHeaderProps {
  /** No longer rendered; kept optional so existing callers don't need to change. */
  icon?: LucideIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned controls (buttons, filters) or stat chips. */
  actions?: ReactNode;
  /** Small metric chips rendered under the title, e.g. "12 active · 3 saved". */
  stats?: ReactNode;
}

// Shared chrome for every dashboard page header, so the app stops looking
// like four hand-rolled variants of the same icon+title+description block.
export function PageHeader({ title, subtitle, actions, stats }: PageHeaderProps) {
  return (
    <header className="sticky top-0 z-10 bg-background border-b px-6 py-4 shrink-0">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="heading-dashboard" data-testid="text-page-title">
              {title}
            </h1>
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
            {stats && <div className="flex items-center gap-2 mt-1.5 flex-wrap">{stats}</div>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-3 flex-wrap">{actions}</div>}
      </div>
    </header>
  );
}
