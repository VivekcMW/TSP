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
    <div className="dashboard-touch-targets flex min-w-0 flex-col items-center justify-center px-4 py-12 text-center sm:py-16">
      <div className="w-16 h-16 rounded-full bg-secondary/15 flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-secondary" aria-hidden="true" />
      </div>
      <h2 className="font-heading text-lg font-medium mb-2 break-words">{title}</h2>
      <div className="text-sm leading-relaxed text-muted-foreground max-w-md mb-4 break-words">{description}</div>
      {action}
    </div>
  );
}
