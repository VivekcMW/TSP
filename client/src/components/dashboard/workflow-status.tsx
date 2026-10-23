import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, MinusCircle, TriangleAlert } from "lucide-react";

export interface WorkflowStatusProps {
  title?: ReactNode;
  children?: ReactNode;
  tone?: "neutral" | "info" | "success" | "warning" | "error";
  actions?: ReactNode;
  live?: boolean;
}

const tones = {
  neutral: { icon: MinusCircle, pair: "bg-muted text-foreground" },
  info: { icon: Info, pair: "bg-info-subtle text-info" },
  success: { icon: CheckCircle2, pair: "bg-success-subtle text-success" },
  warning: { icon: TriangleAlert, pair: "bg-warning-subtle text-warning" },
  error: { icon: AlertCircle, pair: "bg-destructive-subtle text-destructive" },
};

/** Outcome ink on its subtle surface, never white foreground on a pale fill.
 * Static guidance opts out of announcements; changes may announce one local
 * outcome. Actions sit outside the live region to avoid repeated announcements.
 */
export function WorkflowStatus({ title, children, tone = "neutral", actions, live = true }: Readonly<WorkflowStatusProps>) {
  const { icon: Icon, pair } = tones[tone];
  let role: "alert" | "status" | undefined;
  if (live) role = tone === "error" ? "alert" : "status";
  return <div data-workflow-status={tone} className={`min-w-0 space-y-3 rounded-[6px] border border-border p-3 text-sm leading-relaxed ${pair}`}>
    <div role={role} aria-atomic={live || undefined} className="flex min-w-0 items-start gap-2">
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 break-words">
        {title != null && <p className="font-semibold">{title}</p>}
        {children != null && <div>{children}</div>}
      </div>
    </div>
    {actions != null && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
  </div>;
}