import { LegalPage, legalLinkClass, legalTextClass } from "@/components/legal/legal-page";

export default function DataRetentionPage() {
  return <LegalPage title="Data Retention Policy" path="/data-retention" testId="data-retention" description="How long TheSocialPundit keeps account, content, analytics, and billing data." sections={[
    { title: "Retention principle", content: <p className={legalTextClass}>We keep personal data only for as long as it is needed to provide the Service, maintain security, resolve disputes, meet legal obligations, and maintain accurate business records.</p> },
    { title: "Account and profile data", content: <p className={legalTextClass}>Account identity, onboarding preferences, profile links, and settings are retained while your account is active. When you request account deletion, we begin deletion of active account data after verifying the request, subject to the exceptions below.</p> },
    { title: "Content and analytics", content: <p className={legalTextClass}>Drafts, published-content records, inbox preferences, and connected-account analytics are retained while needed for your account history. Connected social credentials are removed when you disconnect the account or request deletion, subject to security logs and legal requirements.</p> },
    { title: "Billing and audit records", content: <p className={legalTextClass}>Payment, subscription, refund, webhook, and audit records may be retained for accounting, tax, fraud prevention, chargeback handling, and legal compliance even after account deletion. We retain only the information needed for those purposes.</p> },
    { title: "Backups and logs", content: <p className={legalTextClass}>Encrypted backups and operational logs may retain copies for a limited backup cycle or longer where required for security and disaster recovery. Expired backups are overwritten according to the hosting provider's backup schedule.</p> },
    { title: "Deletion requests", content: <p className={legalTextClass}>Request access, correction, export, or deletion by emailing <a href="mailto:privacy@thesocialpundit.com" className={legalLinkClass}>privacy@thesocialpundit.com</a>. We will verify the request and explain any data that must be retained.</p> },
  ]} />;
}
