/**
 * Pricing questions answered without live prices, which load per request. Shown on /pricing and
 * marked up as an FAQ, so search and AI answers about pricing can be correct before the plan
 * catalogue loads. Keep in step with the pricing page and the billing policies.
 */
export const PRICING_FAQS = [
  { question: "Is there a free plan?", answer: "Yes. You can start free with no card required. Free plan allowances reset at midnight UTC." },
  { question: "What does the paid plan add?", answer: "Pro adds the complete creation and publishing workflow. The features in each plan are listed on the plan cards on this page." },
  { question: "Which currency are prices in?", answer: "Paid plans are billed in US dollars, with monthly and yearly options. The yearly plan costs less per month." },
  { question: "Can I cancel any time?", answer: "Yes. Pay once for a month or a year, or subscribe and cancel whenever you like from Billing. There is no lock-in." },
  { question: "How are payments handled?", answer: "Payments are processed securely by Razorpay. TheSocialPundit never stores your payment details, and paid access begins only after a successful checkout." },
  { question: "Can I get a refund?", answer: "Refund eligibility and the process are explained in the refund policy." },
] as const;

export function pricingFaqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: PRICING_FAQS.map(faq => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })),
  };
}
