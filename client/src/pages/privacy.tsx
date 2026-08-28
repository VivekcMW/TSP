import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO
        title="Privacy Policy"
        canonical="/privacy"
        description="How TheSocialPundit collects, uses, and protects your data."
      />
      <SiteHeader />
      <main className="flex-1">
        <article className="py-16 lg:py-24" data-testid="section-privacy">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h1 className="heading-display mb-4" data-testid="text-privacy-title">
              Privacy Policy
            </h1>
            <p className="text-sm text-muted-foreground mb-12">Last updated: August 28, 2026</p>

            <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8">
              <section>
                <p className="text-muted-foreground">
                  This Privacy Policy explains what information TheSocialPundit ("we," "us," or "our")
                  collects when you use our website and application (the "Service"), how we use it, and
                  the choices you have. By using the Service, you agree to the collection and use of
                  information as described here.
                </p>
              </section>

              <section>
                <h2 className="heading-section !text-2xl">Information we collect</h2>
                <p className="text-muted-foreground">We collect the following categories of information:</p>
                <ul className="text-muted-foreground space-y-2">
                  <li>
                    <strong className="text-foreground">Account information:</strong> your name, email
                    address, and profile image, managed through our authentication provider, Clerk, when
                    you sign up or sign in.
                  </li>
                  <li>
                    <strong className="text-foreground">Profile details:</strong> the industry and country
                    you select during onboarding, which we use to curate relevant news and tailor AI-generated
                    content for you.
                  </li>
                  <li>
                    <strong className="text-foreground">Content you create:</strong> drafts and published
                    posts you generate or edit within the Service, along with your platform and tone
                    preferences.
                  </li>
                  <li>
                    <strong className="text-foreground">Connected social accounts:</strong> if you choose to
                    connect a LinkedIn or Twitter/X account for analytics, we store the account identifiers
                    and access tokens needed to retrieve your performance metrics. We only request the
                    minimum access scopes required for that feature.
                  </li>
                  <li>
                    <strong className="text-foreground">Usage data:</strong> basic technical information
                    such as log data and session identifiers, used to keep the Service secure and reliable.
                  </li>
                </ul>
              </section>

              <section>
                <h2 className="heading-section !text-2xl">How we use your information</h2>
                <ul className="text-muted-foreground space-y-2">
                  <li>To provide, operate, and maintain the Service, including generating AI-drafted posts.</li>
                  <li>To curate industry news relevant to your selected industry.</li>
                  <li>To retrieve and display analytics for social accounts you've explicitly connected.</li>
                  <li>To communicate with you about your account, updates, or support requests.</li>
                  <li>To detect, prevent, and address security issues or abuse of the Service.</li>
                </ul>
              </section>

              <section>
                <h2 className="heading-section !text-2xl">AI processing</h2>
                <p className="text-muted-foreground">
                  When you generate a post, the relevant news article content and your profile context
                  (such as industry and chosen tone) are sent to Google's Gemini API to produce a draft.
                  This processing is used solely to generate your content and is not used by us to build
                  advertising profiles. Please review Google's own privacy terms for how they handle data
                  processed through their API.
                </p>
              </section>

              <section>
                <h2 className="heading-section !text-2xl">How we share information</h2>
                <p className="text-muted-foreground">
                  We do not sell your personal information. We share data only with the service providers
                  necessary to operate TheSocialPundit — including our authentication provider (Clerk), our
                  AI provider (Google Gemini), and our hosting and database infrastructure — and only to the
                  extent needed for them to perform their function. We may also disclose information if
                  required by law.
                </p>
              </section>

              <section>
                <h2 className="heading-section !text-2xl">Data retention</h2>
                <p className="text-muted-foreground">
                  We retain your account information and content for as long as your account is active. If
                  you'd like your account and associated data deleted, contact us at{" "}
                  <a href="mailto:privacy@thesocialpundit.com" className="text-primary underline">
                    privacy@thesocialpundit.com
                  </a>{" "}
                  and we'll process your request within a reasonable time.
                </p>
              </section>

              <section>
                <h2 className="heading-section !text-2xl">Your rights</h2>
                <p className="text-muted-foreground">
                  Depending on where you live, you may have rights to access, correct, export, or delete your
                  personal information. To exercise any of these rights, email us at{" "}
                  <a href="mailto:privacy@thesocialpundit.com" className="text-primary underline">
                    privacy@thesocialpundit.com
                  </a>
                  .
                </p>
              </section>

              <section>
                <h2 className="heading-section !text-2xl">Cookies</h2>
                <p className="text-muted-foreground">
                  We use essential cookies managed by our authentication provider to keep you signed in and
                  to secure your session. We do not use third-party advertising cookies.
                </p>
              </section>

              <section>
                <h2 className="heading-section !text-2xl">Children's privacy</h2>
                <p className="text-muted-foreground">
                  The Service is intended for working professionals and is not directed at children under
                  16. We do not knowingly collect personal information from children.
                </p>
              </section>

              <section>
                <h2 className="heading-section !text-2xl">Changes to this policy</h2>
                <p className="text-muted-foreground">
                  We may update this Privacy Policy from time to time. We'll update the "Last updated" date
                  above, and for material changes, we'll make reasonable efforts to notify you directly.
                </p>
              </section>

              <section>
                <h2 className="heading-section !text-2xl">Contact us</h2>
                <p className="text-muted-foreground">
                  Questions about this Privacy Policy? Reach us at{" "}
                  <a href="mailto:privacy@thesocialpundit.com" className="text-primary underline">
                    privacy@thesocialpundit.com
                  </a>
                  .
                </p>
              </section>
            </div>
          </div>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
