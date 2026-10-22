import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics-consent";
import { FREE_TOOLS, FREE_TOOLS_HUB_PATH } from "@shared/free-tools";
import type { FreeToolFaq } from "@shared/free-tool-schema";

export function ToolFaqSection({ faqs }: { faqs: readonly FreeToolFaq[] }) {
  return (
    <section className="py-16 lg:py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h2 className="heading-section mb-6">Frequently asked questions</h2>
        <div className="divide-y rounded-2xl border bg-card">
          {faqs.map(faq => (
            <details key={faq.question} className="group p-5">
              <summary className="cursor-pointer list-none font-medium text-foreground">{faq.question}</summary>
              <p className="mt-3 text-sm text-muted-foreground">{faq.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The sign-up pitch shown under a tool's result. `tool` labels the analytics event. */
export function ToolSignupCta({ tool, placement = "result" }: { tool: string; placement?: string }) {
  return (
    <div className="rounded-xl bg-muted p-5">
      <p className="font-medium text-foreground">Want ready-to-post drafts every week, in your own voice?</p>
      <p className="mt-1 text-sm text-muted-foreground">TheSocialPundit finds the news that matters in your field, drafts posts the way you write, and schedules them after you approve.</p>
      <Button asChild size="sm" className="mt-4">
        <Link href="/sign-up" onClick={() => track("tool_signup_click", { tool, placement })} data-testid={`link-${tool}-signup`}>Start free</Link>
      </Button>
    </div>
  );
}

/** Links every other free tool, so each tool page passes visitors and link equity to the rest. */
export function MoreFreeTools({ current }: { current: string }) {
  const others = FREE_TOOLS.filter(tool => tool.path !== current);
  return (
    <section className="border-t py-16 lg:py-20" aria-labelledby="more-free-tools">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <h2 id="more-free-tools" className="heading-section">More free LinkedIn tools</h2>
          <Link href={FREE_TOOLS_HUB_PATH} className="text-sm font-medium text-primary underline-offset-4 hover:underline">See all free tools</Link>
        </div>
        <ul className="grid gap-4 md:grid-cols-3">
          {others.map(tool => (
            <li key={tool.path}>
              <Link href={tool.path} className="group block h-full rounded-2xl border bg-card p-6 transition-colors hover:border-primary" data-testid={`link-tool-${tool.path.split("/").pop()}`}>
                <span className="font-heading text-lg font-semibold capitalize text-foreground">{tool.name}</span>
                <span className="mt-2 block text-sm text-muted-foreground">{tool.summary}</span>
                <span className="mt-4 inline-flex items-center text-sm font-medium text-primary">Try it free<ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
