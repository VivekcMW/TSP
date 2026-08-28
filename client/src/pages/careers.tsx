import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { Reveal } from "@/components/motion/reveal";
import { fadeUp } from "@/lib/motion";
import { Briefcase } from "lucide-react";

export default function CareersPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO
        title="Careers"
        canonical="/careers"
        description="Careers at TheSocialPundit."
      />
      <SiteHeader />
      <main className="flex-1">
        <section className="py-20 lg:py-28" data-testid="section-careers">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <Reveal variants={fadeUp}>
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
                <Briefcase className="w-6 h-6 text-primary" />
              </div>
              <h1 className="heading-display mb-6" data-testid="text-careers-title">
                We're not hiring right now.
              </h1>
              <p className="text-lg text-muted-foreground mb-8">
                We're a small team focused on our early access launch, so we don't have open roles at the
                moment. If that changes, we'll list openings here — but if you're excited about what we're
                building and want to get on our radar early, we'd still love to hear from you.
              </p>
              <a
                href="mailto:hello@thesocialpundit.com?subject=Interested%20in%20future%20roles"
                className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-6 py-3 text-sm font-medium hover-elevate"
                data-testid="link-careers-email"
              >
                Say hello
              </a>
            </Reveal>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
