import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Reveal } from "@/components/motion/reveal";
import { fadeUp } from "@/lib/motion";

interface DashboardEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  action?: ReactNode;
}

// Shared empty state for Inbox/Drafts/Published/Analytics so a first-time
// user doesn't see the same gray circle four times with no personality.
export function DashboardEmptyState({ icon: Icon, title, description, action }: DashboardEmptyStateProps) {
  return (
    <Reveal variants={fadeUp} className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-secondary/15 flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-secondary" />
      </div>
      <h3 className="text-lg font-medium mb-2">{title}</h3>
      <p className="text-muted-foreground max-w-md mb-4">{description}</p>
      {action}
    </Reveal>
  );
}
