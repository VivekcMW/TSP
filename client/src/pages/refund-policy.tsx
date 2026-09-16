import { Link } from "wouter";
import { LegalPage, legalLinkClass, legalTextClass } from "@/components/legal/legal-page";

export default function RefundPolicyPage() {
  return <LegalPage title="Refund Policy" path="/refund-policy" testId="refund-policy" description="TheSocialPundit payment refund policy." sections={[
    { title: "Overview", content: <p className={legalTextClass}>This policy applies to paid plans and payments made through TheSocialPundit. We aim to describe clearly when a payment may be refunded and how to request help.</p> },
    { title: "When refunds may be available", content: <ul className={legalTextClass}><li>Duplicate charges caused by a payment-processing error.</li><li>Unauthorized transactions that you report promptly and that we confirm after review.</li><li>A material technical failure where the paid service was not delivered and the issue could not be reasonably resolved.</li><li>Any other situation where a refund is required by applicable law.</li></ul> },
    { title: "When refunds are generally not available", content: <p className={legalTextClass}>Payments are generally non-refundable for partial billing periods, unused time, a change of mind, or failure to use the Service. We do not provide a refund merely because a subscription is cancelled; cancellation prevents future renewal and does not reverse a completed billing period.</p> },
    { title: "How to request a refund", content: <p className={legalTextClass}>Contact <a href="mailto:billing@thesocialpundit.com" className={legalLinkClass}>billing@thesocialpundit.com</a> with your account email, payment date, amount, and reason. Do not send full card details. We may request transaction identifiers to locate the payment. We normally respond within 10 business days.</p> },
    { title: "Payment processor", content: <p className={legalTextClass}>Payments are processed by Razorpay. Razorpay may apply its own terms and processing rules. Approved refunds are returned through the original payment method where supported.</p> },
    { title: "Related policies", content: <p className={legalTextClass}>See our <Link href="/subscription-cancellation" className={legalLinkClass}>Subscription Cancellation Policy</Link> and <Link href="/terms" className={legalLinkClass}>Terms of Service</Link>.</p> },
  ]} />;
}
