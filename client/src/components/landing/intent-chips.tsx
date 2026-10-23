import { Link } from "wouter";

const intents = [
  { label: "Post on LinkedIn every week", href: "/sign-up" },
  { label: "Grow on X", href: "/sign-up" },
  { label: "Reach China, Japan and Korea", href: "#markets" },
  { label: "Turn news into posts in seconds", href: "#product-create" },
  { label: "See it in action", href: "/how-it-works" },
];

/** "What do you want to do?" shortcuts under the hero. */
export function IntentChips() {
  return (
    <section className="border-b bg-card pb-8" aria-labelledby="intent-heading" data-testid="section-intents">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 sm:px-6 lg:flex-row lg:items-center lg:gap-4 lg:px-8">
        <h2 id="intent-heading" className="shrink-0 text-sm font-semibold text-foreground">What do you want to do?</h2>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {intents.map(intent => {
            const className = "inline-flex min-h-11 shrink-0 items-center rounded-full border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:border-primary hover:text-primary";
            return intent.href.startsWith("#")
              ? <a key={intent.label} href={intent.href} className={className}>{intent.label}</a>
              : <Link key={intent.label} href={intent.href} className={className}>{intent.label}</Link>;
          })}
        </div>
      </div>
    </section>
  );
}
