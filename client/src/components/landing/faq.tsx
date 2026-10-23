import { Link } from "wouter";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Reveal } from "@/components/motion/reveal";
import { FAQS } from "./landing-content";

export function FAQ() {
  return (
    <section className="py-20 lg:py-28" data-testid="section-faq">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16 lg:px-8">
        <Reveal className="space-y-4">
          <h2 className="heading-section">Questions, answered</h2>
          <p className="text-lg text-muted-foreground">Straight answers, no fine print. Still curious?</p>
          <Link href="/contact" className="inline-flex min-h-11 items-center rounded-md border-2 border-primary px-5 font-semibold text-primary hover:bg-accent">
            Contact us
          </Link>
        </Reveal>
        <Reveal delay={0.1}>
          <Accordion type="single" collapsible className="w-full">
            {FAQS.map((faq, index) => (
              <AccordionItem key={faq.question} value={`item-${index}`} data-testid={`accordion-faq-${index}`}>
                <AccordionTrigger className="min-h-14 text-left text-base font-medium">{faq.question}</AccordionTrigger>
                <AccordionContent className="text-base leading-relaxed text-muted-foreground">{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </section>
  );
}
