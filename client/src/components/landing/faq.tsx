import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Reveal } from "@/components/motion/reveal";

const faqs = [
  {
    question: "Will posts actually sound like me, not like generic AI?",
    answer:
      "Every draft is generated from a real, current article in your industry and forced to take a specific stance — not summarize the news neutrally. You also choose a tonality (Thought Leader, Industry Insider, Provocateur, or Data-Driven) so the voice stays consistent. You can always edit before publishing.",
  },
  {
    question: "Does this auto-post without my approval?",
    answer:
      "No. Every draft lands in your Drafts queue for you to review, edit, or discard first. Nothing goes out under your name without you approving it.",
  },
  {
    question: "Which platforms actually one-click publish vs. copy-paste?",
    answer:
      "LinkedIn and Twitter/X support direct account connection for streamlined posting. The other 21 platforms — from Threads, Bluesky, and Reddit to regional networks like Xing, Weibo, and Naver Blog — generate a ready-to-post draft that you copy into that platform, since many of them don't offer a public API for third-party publishing.",
  },
  {
    question: "What happens after the free access period?",
    answer:
      "We're free for the first 1,000 subscribers while we grow. Pricing after that will be announced with plenty of notice — nothing changes on your account without you knowing first.",
  },
  {
    question: "Is my data used to train any AI models?",
    answer:
      "No. We use your industry and preferences to select relevant news and draft posts for you — that information isn't used to train models for other users.",
  },
  {
    question: "What if I don't like a draft?",
    answer:
      "Edit it, regenerate it in a different tonality, or skip it entirely. You're never required to publish anything TheSocialPundit drafts.",
  },
];

export function FAQ() {
  return (
    <section className="py-20 lg:py-28" data-testid="section-faq">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="text-center mb-12">
          <h2 className="heading-section mb-4">Questions professionals ask us.</h2>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Straight answers, no fine print.
          </p>
        </Reveal>

        <Reveal delay={0.1}>
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq, index) => (
              <AccordionItem key={index} value={`item-${index}`} data-testid={`accordion-faq-${index}`}>
                <AccordionTrigger className="text-left text-base font-medium">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </section>
  );
}
