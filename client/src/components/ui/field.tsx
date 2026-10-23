import * as React from "react"

import { Label } from "@/components/ui/label"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import { cn } from "@/lib/utils"

/** Shared by native and Radix controls; read-only styling belongs on text inputs only. */
export const fieldControlClassName = "min-h-11 min-w-0 w-full rounded-[var(--radius)] border border-input bg-card px-3 py-2 text-base leading-6 text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 aria-[invalid=true]:border-destructive disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground md:text-sm"

/** Button-backed pickers are fields, not compact actions. Keep their label and arrow on opposite edges. */
export const fieldTriggerClassName = `${fieldControlClassName} text-left font-normal [&>[data-button-label]]:w-full [&>[data-button-label]]:justify-between [&>[data-button-label]]:gap-2`

/** Reserve the same label row with or without an info button, including touch layouts. */
export const fieldLabelRowClassName = "field-label-row flex min-h-9 min-w-0 items-center gap-1"

/** Compose existing help IDs rather than replacing a caller's accessibility wiring. */
export function mergeIdRefs(...values: (string | undefined)[]) {
  const ids = values.flatMap((value) => value?.trim().split(/\s+/).filter(Boolean) ?? [])
  return ids.length ? [...new Set(ids)].join(" ") : undefined
}

export interface FieldControlProps {
  id: string
  "aria-labelledby": string
  "aria-describedby"?: string
  "aria-invalid": React.AriaAttributes["aria-invalid"]
}

export interface FieldProps extends Omit<React.ComponentPropsWithoutRef<"div">, "children"> {
  /** ID of the actual control, not the wrapper. Automatically unique when omitted. */
  id?: string
  label: React.ReactNode
  help?: React.ReactNode
  error?: React.ReactNode
  counter?: React.ReactNode
  invalid?: boolean
  /** Existing external descriptions/names are retained alongside the field's IDs. */
  controlProps?: Pick<React.AriaAttributes, "aria-describedby" | "aria-labelledby" | "aria-invalid">
  /** Spread onto the native control or Radix trigger, not a non-focusable wrapper. */
  render: (controlProps: FieldControlProps) => React.ReactNode
}

function hasContent(value: React.ReactNode) {
  return value != null && value !== false && value !== ""
}

/** A label/help/error/counter contract with no form-state dependency or cloned controls. */
export function Field({ id, label, help, error, counter, invalid, controlProps, render, className, ...props }: Readonly<FieldProps>) {
  const generatedId = React.useId()
  const controlId = id ?? `field-${generatedId}`
  const labelId = `${controlId}-label`
  const helpId = `${controlId}-help`
  const errorId = `${controlId}-error`
  const counterId = `${controlId}-counter`
  const showHelp = hasContent(help)
  const showError = hasContent(error)
  const showCounter = hasContent(counter)
  const accessibility: FieldControlProps = {
    id: controlId,
    "aria-labelledby": mergeIdRefs(labelId, controlProps?.["aria-labelledby"])!,
    "aria-describedby": mergeIdRefs(controlProps?.["aria-describedby"], showHelp ? helpId : undefined, showError ? errorId : undefined, showCounter ? counterId : undefined),
    "aria-invalid": showError || invalid || controlProps?.["aria-invalid"] || false,
  }

  return (
    <div {...props} data-field="" className={cn("grid min-w-0 gap-2", className)}>
      <div data-field-label="" className={fieldLabelRowClassName}>
        <Label id={labelId} htmlFor={controlId} className="min-w-0 break-words text-sm font-medium leading-5">{label}</Label>
        {showHelp && <InfoTooltip labelledBy={labelId} descriptionId={helpId}>{help}</InfoTooltip>}
      </div>
      {render(accessibility)}
      {showError && <p id={errorId} role="alert" className="break-words text-sm font-medium leading-relaxed text-destructive">{error}</p>}
      {showCounter && <p id={counterId} className="break-words text-xs leading-5 tabular-nums text-muted-foreground">{counter}</p>}
    </div>
  )
}