import * as React from "react"

import { Button, type ButtonProps } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type GroupName =
  | { "aria-label": string; "aria-labelledby"?: string }
  | { "aria-label"?: string; "aria-labelledby": string }

export type SegmentedControlProps = Omit<React.ComponentPropsWithoutRef<"fieldset">, "role"> & GroupName

/** Named pressed-button group, not tabs. Supports single or multiple selection owned
 * by the caller; every item retains native Tab/Enter/Space behavior. No fixed height.
 */
export const SegmentedControl = React.forwardRef<HTMLFieldSetElement, SegmentedControlProps>(
  ({ className, ...props }, ref) => (
    <fieldset {...props} ref={ref} data-segmented-control="" className={cn("m-0 inline-flex min-w-0 max-w-full flex-wrap items-center gap-1 rounded-[var(--radius)] border-0 bg-muted p-1", className)} />
  ),
)
SegmentedControl.displayName = "SegmentedControl"

export interface SegmentedControlItemProps extends Omit<ButtonProps, "variant" | "aria-pressed" | "asChild"> {
  selected: boolean
}

export const SegmentedControlItem = React.forwardRef<HTMLButtonElement, SegmentedControlItemProps>(
  ({ selected, type = "button", size = "sm", ...props }, ref) => (
    <Button {...props} ref={ref} type={type} size={size} variant={selected ? "selected" : "ghost"} aria-pressed={selected} />
  ),
)
SegmentedControlItem.displayName = "SegmentedControlItem"