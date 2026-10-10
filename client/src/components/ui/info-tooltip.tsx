import { useId, useRef, useState, type ReactNode } from "react"
import { Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipPortal, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface InfoTooltipProps {
  children: ReactNode
  /** Use a visible label's ID for rich labels, or a plain-text name. */
  labelledBy?: string
  label?: string
  /** Stable help ID, usable by the associated control even while closed. */
  descriptionId?: string
  className?: string
}

/** Supplementary, non-interactive help only. Errors, consent and live status
 * belong in the page. The trigger is a sibling of its label, never inside it. */
export function InfoTooltip({ children, labelledBy, label, descriptionId, className }: Readonly<InfoTooltipProps>) {
  const id = useId()
  const helpId = descriptionId ?? `${id}-info`
  const [open, setOpen] = useState(false)
  const pointerOpen = useRef<boolean | null>(null)
  const accessibleName = label ? `About ${label}` : "More information"
  return <>
    <span id={helpId} className="sr-only" data-info-description="">{children}</span>
    <TooltipProvider delayDuration={200}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <Button type="button" variant="ghost" size="icon" data-info-trigger=""
            className={cn("shrink-0 text-muted-foreground hover:text-foreground", className)}
            aria-label={labelledBy ? undefined : accessibleName}
            aria-labelledby={labelledBy ? `${id}-name ${labelledBy}` : undefined}
            aria-describedby={helpId}
            onPointerDown={() => { pointerOpen.current = !open }}
            onPointerCancel={() => { pointerOpen.current = null }}
            onKeyDown={() => { pointerOpen.current = null }}
            onClick={event => {
              // Radix normally dismisses on click. Keep a tap-to-toggle path
              // based on pointer-down: touch focus may open it before click.
              event.preventDefault()
              setOpen(pointerOpen.current ?? !open)
              pointerOpen.current = null
            }}>
            <Info aria-hidden="true" />
            {labelledBy && <span id={`${id}-name`} className="sr-only">About</span>}
          </Button>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent data-info-popup="" side="top" sideOffset={6} collisionPadding={16}
            className="max-w-[min(22rem,calc(100vw-2rem))] break-words text-left leading-relaxed motion-reduce:!animate-none">
            {children}
          </TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </TooltipProvider>
  </>
}