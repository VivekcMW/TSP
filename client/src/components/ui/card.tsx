import * as React from "react"

import { cn } from "@/lib/utils"
import { InfoTooltip } from "@/components/ui/info-tooltip"

export type CardDensity = "compact" | "comfortable"
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Compact: 12px. Comfortable: 16px mobile / 24px desktop. Inherited by sections. */
  density?: CardDensity
}

const CardDensityContext = React.createContext<CardDensity>("comfortable")
const cardPadding: Record<CardDensity, string> = {
  compact: "p-3",
  comfortable: "p-4 sm:p-6",
}

const Card = React.forwardRef<
  HTMLDivElement,
  CardProps
>(({ className, density = "comfortable", ...props }, ref) => (
  <CardDensityContext.Provider value={density}>
    <div
      ref={ref}
      data-density={density}
      className={cn(
        "shadcn-card min-w-0 rounded-[var(--radius)] border border-card-border bg-card text-card-foreground shadow-sm",
        className
      )}
      {...props}
    />
  </CardDensityContext.Provider>
));
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  CardProps
>(({ className, density, ...props }, ref) => {
  const inheritedDensity = React.useContext(CardDensityContext)
  return <div ref={ref} className={cn("flex min-w-0 flex-col gap-2", cardPadding[density ?? inheritedDensity], className)} {...props} />
});
CardHeader.displayName = "CardHeader"

export interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Choose the next logical heading level; a card never introduces another page h1. */
  as?: "h2" | "h3" | "h4" | "h5" | "h6"
  /** Optional explanatory copy; keep live status/consent outside the tooltip. */
  help?: React.ReactNode
  helpId?: string
}

// Heading and legacy div refs retain their compatible DOM focus/measurement API.
const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  CardTitleProps
>(({ className, as: Comp = "h2", help, helpId, id, ...props }, ref) => {
  const generatedId = React.useId()
  const headingId = id ?? (help ? `${generatedId}-title` : undefined)
  const heading = <Comp
    ref={ref}
    id={headingId}
    className={cn(
      "min-w-0 break-words font-heading text-lg font-semibold leading-snug tracking-tight",
      className
    )}
    {...props}
  />
  return help ? <div className="flex min-w-0 items-center gap-1">{heading}<InfoTooltip labelledBy={headingId} descriptionId={helpId}>{help}</InfoTooltip></div> : heading
})
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("break-words text-sm leading-relaxed text-muted-foreground", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  CardProps
>(({ className, density, ...props }, ref) => {
  const inheritedDensity = React.useContext(CardDensityContext)
  return <div ref={ref} className={cn("min-w-0 break-words", cardPadding[density ?? inheritedDensity], "pt-0 sm:pt-0", className)} {...props} />
})
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  CardProps
>(({ className, density, ...props }, ref) => {
  const inheritedDensity = React.useContext(CardDensityContext)
  return <div ref={ref} className={cn("flex min-w-0 flex-wrap items-center gap-3", cardPadding[density ?? inheritedDensity], "pt-0 sm:pt-0", className)} {...props} />
})
CardFooter.displayName = "CardFooter"
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
}
