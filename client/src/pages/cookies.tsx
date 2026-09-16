import { LegalPage, legalLinkClass, legalTextClass } from "@/components/legal/legal-page";

export default function CookiePolicyPage() {
  return <LegalPage title="Cookie Policy" path="/cookies" testId="cookies" description="How TheSocialPundit uses cookies and similar technologies." sections={[
    { title: "What cookies are", content: <p className={legalTextClass}>Cookies are small text files stored by your browser. Similar technologies may store session or preference information. We use these tools only where needed for the website and application to work securely and reliably.</p> },
    { title: "Essential cookies", content: <p className={legalTextClass}>Authentication and session cookies help keep you signed in, protect requests, and maintain the correct account and tenant context. These cookies are necessary for core application functionality.</p> },
    { title: "Preferences and security", content: <p className={legalTextClass}>We may use limited browser storage or cookies to remember interface preferences and support security controls. These are not used to sell your information or create third-party advertising profiles.</p> },
    { title: "Analytics and advertising", content: <p className={legalTextClass}>The current application does not intentionally use third-party advertising cookies. If optional analytics or marketing technologies are introduced, this policy will be updated and consent will be requested where required by law.</p> },
    { title: "Your choices", content: <p className={legalTextClass}>You can restrict or delete cookies through your browser settings. Blocking essential cookies may prevent sign-in or other application features from working correctly.</p> },
    { title: "Questions", content: <p className={legalTextClass}>For privacy questions, contact <a href="mailto:privacy@thesocialpundit.com" className={legalLinkClass}>privacy@thesocialpundit.com</a>. See our <a href="/privacy" className={legalLinkClass}>Privacy Policy</a> for more information.</p> },
  ]} />;
}
