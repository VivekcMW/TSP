import type { LucideIcon } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { InfoTooltip } from "@/components/ui/info-tooltip";

export type PageWidth = "reading" | "standard" | "workbench";

// One contract for both edges of a page: 48rem / 64rem / 80rem.
const pageWidths: Record<PageWidth, string> = {
  reading: "max-w-3xl",
  standard: "max-w-5xl",
  workbench: "max-w-7xl",
};

interface PageContentProps {
  /** Pass the same width to PageHeader and PageBody. */
  width?: PageWidth;
  /** Legacy escape hatch; apply the same override to the header and body. */
  contentClassName?: string;
}

export interface PageHeaderProps extends Omit<ComponentPropsWithoutRef<"header">, "title" | "children">, PageContentProps {
  /** No longer rendered; kept optional so existing callers don't need to change. */
  icon?: LucideIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Supplementary instructions, distinct from visible counts and live status. */
  help?: ReactNode;
  /** Essential actions only. Put secondary filters in PageToolbar in PageBody. */
  actions?: ReactNode;
  /** Small metric chips rendered under the title, e.g. "12 active · 3 saved". */
  stats?: ReactNode;
  /** Disable when the parent already owns the sticky identity region. */
  sticky?: boolean;
}

// Shared chrome for every dashboard page header, so the app stops looking
// like four hand-rolled variants of the same icon+title+description block.
export function PageHeader({ icon: _icon, title, subtitle, help, actions, stats, width = "standard", sticky = true, className, contentClassName, ...props }: Readonly<PageHeaderProps>) {
  return (
    <header {...props} data-page-header="" data-page-width={width} className={cn("dashboard-gutter min-w-0 shrink-0 border-b bg-card px-4 py-2 sm:px-6", sticky && "sticky top-0 z-10", className)}>
      <div data-page-container="" data-page-width={width} className={cn("dashboard-container flex flex-wrap items-start justify-between gap-4", pageWidths[width], contentClassName)}>
        <div data-page-identity="" className="min-w-0 flex-1 basis-64">
          <div className="flex min-w-0 items-center gap-1">
            <h1 className="heading-dashboard min-w-0 [overflow-wrap:anywhere] text-2xl font-semibold" data-testid="text-page-title">
              {title}
            </h1>
            {help && <InfoTooltip label={typeof title === "string" ? title : "this page"}>{help}</InfoTooltip>}
          </div>
          {subtitle != null && <p className="mt-0.5 [overflow-wrap:anywhere] text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}
          {stats != null && <div className="flex items-center gap-2 mt-1 flex-wrap tabular-nums">{stats}</div>}
        </div>
        {actions != null && <div data-page-actions="" className="flex w-full min-w-0 max-w-full flex-wrap items-center justify-end gap-2 sm:w-auto">{actions}</div>}
      </div>
    </header>
  );
}

export type PageBodyProps = ComponentPropsWithoutRef<"main"> & PageContentProps & {
  /** Use div when a surrounding main already contains the page heading. */
  as?: "main" | "div";
  /** Default: this body scrolls. False: the parent or split panes own scrolling. */
  scrollable?: boolean;
};

/** Shares PageHeader's width/gutters; className retains the existing scroll escape hatch. */
export function PageBody({ children, as: Comp = "main", width = "standard", scrollable = true, className, contentClassName, ...props }: Readonly<PageBodyProps>) {
  return (
    <Comp {...props} data-page-body="" data-page-width={width} data-page-scroll={scrollable ? "body" : "parent"} className={cn("dashboard-gutter min-h-0 min-w-0 flex-1 px-4 py-4 sm:px-6 sm:py-6", scrollable && "overflow-y-auto", className)}>
      <div data-page-container="" data-page-width={width} className={cn("dashboard-container", pageWidths[width], contentClassName)}>{children}</div>
    </Comp>
  );
}

export interface PageToolbarProps extends ComponentPropsWithoutRef<"fieldset"> {
  actions?: ReactNode;
}

/** Place inside PageBody, not the sticky PageHeader. No fixed height or extra gutters.
 * A named group, not an ARIA toolbar: controls retain their native Tab behavior.
 */
export function PageToolbar({ children, actions, className, "aria-label": label = "Page controls", ...props }: Readonly<PageToolbarProps>) {
  return (
    <fieldset
      {...props}
      aria-label={label}
      data-page-toolbar=""
      className={cn("static m-0 flex min-w-0 max-w-full flex-wrap items-end gap-3 border-0 p-0", className)}
    >
      {children != null && <div data-page-filters="" className="flex min-w-0 max-w-full flex-1 basis-64 flex-wrap items-end gap-3">{children}</div>}
      {actions != null && <div data-page-actions="" className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </fieldset>
  );
}
