import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface DashboardEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  action?: ReactNode;
}

// Shared empty state for Inbox/Drafts/Published/Analytics so a first-time
// user doesn't see the same gray circle four times with no personality.
export function DashboardEmptyState({ icon: Icon, title, description, action }: Readonly<DashboardEmptyStateProps>) {
  return (
    <div className="dashboard-touch-targets flex min-w-0 max-w-full flex-col items-center justify-center px-4 py-12 text-center sm:py-16">
      <div className="w-16 h-16 shrink-0 rounded-full bg-accent flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-accent-foreground" aria-hidden="true" />
      </div>
      <h2 className="max-w-full font-heading text-lg font-medium mb-2 [overflow-wrap:anywhere]">{title}</h2>
      <div className="min-w-0 max-w-full text-sm leading-relaxed text-muted-foreground sm:max-w-md mb-4 [overflow-wrap:anywhere]">{description}</div>
      {action && <div className="min-w-0 max-w-full">{action}</div>}
    </div>
  );
}
