import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { Reveal } from "@/components/motion/reveal";
import { fadeUp } from "@/lib/motion";
import { BookOpen, Sparkles } from "lucide-react";

export default function CaseStudiesPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO
        title="Case Studies"
        canonical="/case-studies"
        description="Customer stories from professionals using TheSocialPundit — coming soon."
      />
      <SiteHeader />
      <main className="flex-1">
        <section className="py-20 lg:py-28" data-testid="section-case-studies">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <Reveal variants={fadeUp}>
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
                <BookOpen className="w-6 h-6 text-primary" />
              </div>
              <h1 className="heading-display mb-6" data-testid="text-case-studies-title">
                Customer stories, coming soon.
              </h1>
              <p className="text-lg text-muted-foreground mb-8">
                We're early — real results from real customers will live here as soon as we have them.
                We'd rather wait and show you genuine stories than make any up. In the meantime, see
                exactly how the product works.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-4">
                <Link href="/how-it-works" data-testid="link-case-studies-how-it-works">
                  <Button variant="outline" size="lg">
                    See How It Works
                  </Button>
                </Link>
                <Link href="/sign-up" data-testid="link-case-studies-signup">
                  <Button size="lg">
                    <Sparkles className="w-4 h-4 mr-2" />
                    Start Free Today
                  </Button>
                </Link>
              </div>
            </Reveal>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
