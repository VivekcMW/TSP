import { shadcn } from "@clerk/themes";
import { color, invariant, type Theme } from "@/design/tokens";

/**
 * Clerk's <SignIn>/<SignUp> theming, derived from the design system.
 *
 * Clerk's `variables` API cannot read CSS custom properties, so it needs
 * literal colours — which is why this file previously restated ~15 token
 * values as hardcoded `hsl(...)` strings. When the brand moved from purple to
 * navy every one had to be edited by hand. They now come from
 * `design/tokens.ts` via `color()`.
 *
 * `elements` takes class names, so those use the semantic Tailwind classes
 * instead of arbitrary values. That also makes the auth screens theme-aware:
 * they previously carried light-mode colours regardless of theme.
 */
export function buildClerkAppearance(basePath: string, theme: Theme = "light") {
  const c = (token: Parameters<typeof color>[0], alpha?: number) =>
    color(token, theme, alpha);

  return {
    theme: shadcn,
    options: {
      logoPlacement: "inside" as const,
      logoLinkUrl: basePath || "/",
      logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
    },
    variables: {
      colorPrimary: c("primary"),
      colorForeground: c("foreground"),
      colorMutedForeground: c("muted-foreground"),
      colorDanger: c("destructive"),
      colorBackground: c("card"),
      colorInput: c("card"),
      colorInputForeground: c("foreground"),
      colorNeutral: c("border"),
      fontFamily: invariant["font-sans"],
      borderRadius: invariant.radius,
    },
    elements: {
      rootBox: "w-full flex justify-center",
      cardBox:
        "bg-card border border-card-border rounded-2xl w-[440px] max-w-full overflow-hidden shadow-lg",
      card: "!shadow-none !border-0 !bg-transparent !rounded-none",
      footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
      headerTitle: "text-foreground text-xl font-semibold",
      headerSubtitle: "text-muted-foreground",
      socialButtonsBlockButtonText: "text-foreground font-medium",
      formFieldLabel: "text-foreground font-medium",
      footerActionLink: "text-primary font-medium hover:opacity-90",
      footerActionText: "text-muted-foreground",
      dividerText: "text-muted-foreground",
      identityPreviewEditButton: "text-primary",
      formFieldSuccessText: "text-foreground",
      alertText: "text-foreground",
      logoBox: "flex justify-center mb-2",
      logoImage: "h-8 w-8",
      socialButtonsBlockButton: "border border-border hover:bg-accent",
      formButtonPrimary: "bg-primary text-primary-foreground hover:opacity-90",
      formFieldInput: "bg-card border border-input text-foreground",
      footerAction: "text-center",
      dividerLine: "bg-border",
      alert: "bg-destructive/10 border border-destructive/30",
      otpCodeFieldInput: "bg-card border border-input text-foreground",
      formFieldRow: "",
      main: "",
    },
  };
}
