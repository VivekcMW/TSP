import { Mail } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import { NewsletterSignup } from "@/components/newsletter-signup";

/** Newsletter band for visitors who aren't ready to sign up yet. */
export function NewsletterBanner() {
  return (
    <section className="py-16 lg:py-20" data-testid="section-newsletter" aria-labelledby="newsletter-heading">
      <Reveal className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-8 rounded-2xl border bg-accent p-7 sm:p-10 lg:grid-cols-[1fr_1.1fr] lg:gap-12">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Mail className="h-6 w-6" aria-hidden="true" />
            </span>
            <div className="space-y-2">
              <h2 id="newsletter-heading" className="font-heading text-2xl font-semibold text-foreground sm:text-3xl">Get one email a month</h2>
              <p className="text-muted-foreground">Posting ideas that work, new features and guides from TheSocialPundit. No spam.</p>
            </div>
          </div>
          <NewsletterSignup source="landing" />
        </div>
      </Reveal>
    </section>
  );
}
