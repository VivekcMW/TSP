import { Link } from "wouter";
import { LegalPage, legalLinkClass, legalTextClass } from "@/components/legal/legal-page";

export default function SubscriptionCancellationPage() {
  return <LegalPage title="Subscription Cancellation Policy" path="/subscription-cancellation" testId="subscription-cancellation" description="How to cancel a TheSocialPundit subscription and what happens afterward." sections={[
    { title: "How to cancel", content: <p className={legalTextClass}>If your account has an active subscription, open Billing from the dashboard and choose <strong className="text-foreground">Cancel subscription</strong>. The request is confirmed before it is submitted. If you cannot access your account, contact <a href="mailto:billing@thesocialpundit.com" className={legalLinkClass}>billing@thesocialpundit.com</a>.</p> },
    { title: "When cancellation takes effect", content: <p className={legalTextClass}>Cancellation is scheduled for the end of the current paid billing period. Your paid access remains available until the period-end date shown in Billing. You will not be charged for a new period after cancellation is confirmed.</p> },
    { title: "No automatic prorated refund", content: <p className={legalTextClass}>Cancelling does not automatically create a prorated refund for unused time. Refund requests are handled under our <Link href="/refund-policy" className={legalLinkClass}>Refund Policy</Link> and applicable law.</p> },
    { title: "Payment and renewal records", content: <p className={legalTextClass}>We retain the minimum billing and transaction records needed for accounting, fraud prevention, disputes, and legal obligations. See our <Link href="/data-retention" className={legalLinkClass}>Data Retention Policy</Link>.</p> },
    { title: "Questions", content: <p className={legalTextClass}>For cancellation or billing help, email <a href="mailto:billing@thesocialpundit.com" className={legalLinkClass}>billing@thesocialpundit.com</a>.</p> },
  ]} />;
}
