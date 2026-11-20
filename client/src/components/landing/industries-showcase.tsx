import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";

const industries = [
  "Media & Advertising",
  "Technology & SaaS",
  "Finance & Banking",
  "Healthcare & Pharma",
  "E-commerce & Retail",
  "Consulting & Services",
  "Legal Services",
  "Hospitality & Travel",
  "Real Estate",
  "Education & EdTech",
  "Product Marketing",
  "Manufacturing",
  "Energy & Sustainability",
  "Non-profit & NGO",
  "Government",
  "Entertainment",
  "Telecommunications",
  "Agriculture & Food",
];

export function IndustriesShowcase() {
  return (
    <section id="industries" className="scroll-mt-20 bg-card py-16 lg:py-20" data-testid="section-industries">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-secondary-text">Every field. Every niche.</p>
          <h2 className="mt-4 heading-section text-balance">Your industry, your point of view on LinkedIn.</h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Tell Pundit what you do. It follows the stories shaping your field and helps turn your expertise into thoughtful LinkedIn posts.
          </p>
        </Reveal>

        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {industries.map(industry => (
            <span key={industry} className="rounded-full border bg-background px-3.5 py-2 text-sm text-muted-foreground">
              {industry}
            </span>
          ))}
        </div>

        <Reveal className="mt-8 flex flex-col items-center justify-between gap-4 rounded-xl border bg-background p-5 text-center sm:flex-row sm:text-left">
          <div>
            <p className="font-semibold text-foreground">No preset required</p>
            <p className="mt-1 text-sm text-muted-foreground">
              These are examples, not limits. Your expertise defines the brief.
            </p>
          </div>
          <Link href="/sign-up" className="inline-flex min-h-11 shrink-0 items-center gap-1.5 font-semibold text-primary hover:underline">
            Build your LinkedIn brief<ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
