import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "control-touch-target relative inline-flex shrink-0 max-w-full items-center justify-center gap-1.5 whitespace-normal break-words rounded-[var(--radius)] border border-transparent text-sm font-medium leading-5 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:border-border aria-disabled:cursor-not-allowed aria-disabled:bg-muted aria-disabled:text-muted-foreground aria-disabled:border-border [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&>[data-button-label]>svg]:mx-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active",
        destructive:
          "bg-destructive text-destructive-foreground border-destructive-border",
        outline:
          "border-input bg-card text-foreground hover:bg-secondary-hover active:bg-secondary-hover",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary-hover active:bg-secondary-hover",
        // Selection is not a neutral secondary action. Pair with aria-pressed or tab semantics.
        selected: "border-primary bg-accent text-accent-foreground",
        ghost: "text-foreground hover:bg-secondary-hover active:bg-secondary-hover",
      },
      // Minimums allow translated labels and text zoom to grow without clipping.
      // control-touch-target raises every size to 44px on narrow/coarse-pointer layouts.
      size: {
        default: "min-h-9 min-w-9 px-3 py-1.5",
        standard: "min-h-9 min-w-9 px-3 py-1.5",
        sm: "min-h-8 min-w-8 px-2.5 py-1 text-[0.8125rem]",
        lg: "min-h-10 min-w-10 px-4 py-2",
        icon: "min-h-9 min-w-9 p-1.5",
        // Dense toolbar actions, not primary CTAs; touch minimums still apply.
        compact: "min-h-8 min-w-8 px-2 py-1 text-[0.8125rem]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** One ref-forwarding link child; never wrap a Button in a link. */
  asChild?: boolean
  /** Keep children/aria-label unchanged while busy; the label still reserves its space. */
  loading?: boolean
}

function ButtonContent({ children, loading }: Readonly<{ children: React.ReactNode; loading: boolean }>) {
  return (
    <>
      <span data-button-label="" className={cn("inline-flex min-w-0 items-center justify-center gap-1.5 [overflow-wrap:anywhere]", loading && "opacity-0")}>{children}</span>
      {loading && <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" /></span>}
    </>
  )
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, onClickCapture, onAuxClickCapture, onKeyDownCapture, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    const blocked = disabled || loading
    // Slot keeps the anchor/router link as the only interactive element and composes refs.
    const child = asChild ? React.Children.only(children) as React.ReactElement<{ children?: React.ReactNode }> : null
    const content = <ButtonContent loading={loading}>{child ? child.props.children : children}</ButtonContent>
    return (
      <Comp
        {...props}
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={asChild ? undefined : blocked}
        aria-disabled={blocked || props["aria-disabled"]}
        aria-busy={loading || props["aria-busy"]}
        data-loading={loading || undefined}
        onClickCapture={(event) => {
          if (blocked) { event.preventDefault(); event.stopPropagation(); return }
          onClickCapture?.(event)
        }}
        onAuxClickCapture={(event) => {
          if (blocked) { event.preventDefault(); event.stopPropagation(); return }
          onAuxClickCapture?.(event)
        }}
        onKeyDownCapture={(event) => {
          if (blocked && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); event.stopPropagation(); return }
          onKeyDownCapture?.(event)
        }}
      >
        {child ? React.cloneElement(child, undefined, content) : content}
      </Comp>
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
