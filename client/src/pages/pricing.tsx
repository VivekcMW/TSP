import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { Link } from "wouter";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { fadeUp } from "@/lib/motion";

const earlyAdopterFeatures = [
  { text: "10 Curated articles per day", included: true },
  { text: "Unlimited AI post generations", included: true },
  { text: "All 4 tonality styles", included: true },
  { text: "23 platforms — LinkedIn to Reddit, Weibo, Mastodon & developer blogs", included: true },
  { text: "Hot Trends analysis", included: true },
  { text: "Instant Review (any URL)", included: true },
];

const comingSoonFeatures = [
  { text: "One-click scheduling", included: true },
  { text: "Analytics dashboard", included: true },
  { text: "Team collaboration", included: true },
  { text: "Custom RSS feeds", included: true },
];

export default function Pricing() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO 
        title="Pricing"
        canonical="/pricing"
        description="Simple, value-based pricing for TheSocialPundit. Start free and scale your professional authority with plans starting at $0/month."
      />
      <SiteHeader />
      
      <main className="flex-1">
        <section className="py-20 lg:py-28" data-testid="section-pricing">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <Reveal variants={fadeUp} className="text-center mb-16">
              <Badge className="bg-success/10 text-success border-success/20 text-sm font-bold tracking-wider uppercase px-4 py-2 mb-6">
                Free for the First 1,000 Subscribers
              </Badge>
              <h1 className="heading-display mb-6" data-testid="text-pricing-headline">
                Start building authority today.
              </h1>
              <p className="text-lg text-muted-foreground max-w-xl mx-auto">
                We're opening TheSocialPundit to early adopters for free. Get full access while we grow together.
              </p>
            </Reveal>
            
            <StaggerGroup className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
              <StaggerItem>
              <Card className="p-8 relative bg-slate-900 dark:bg-slate-950 text-white border-slate-800 h-full" data-testid="card-pricing-early-adopter">
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-success text-success-foreground">
                  EARLY ADOPTER
                </Badge>
                
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold">Full Access</h3>
                    <div className="mt-4 flex items-baseline gap-2">
                      <span className="text-4xl font-bold">$0</span>
                      <span className="text-slate-400 line-through">$49/mo</span>
                    </div>
                    <p className="mt-4 text-sm text-slate-400">
                      Everything you need to build your professional authority. Free while we grow.
                    </p>
                  </div>
                  
                  <ul className="space-y-3">
                    {earlyAdopterFeatures.map((feature, index) => (
                      <li key={index} className="flex items-center gap-3 text-sm">
                        <div className="w-4 h-4 rounded-full bg-success flex items-center justify-center">
                          <Check className="w-3 h-3 text-success-foreground" />
                        </div>
                        <span>{feature.text}</span>
                      </li>
                    ))}
                  </ul>
                  
                  <Link href="/sign-up">
                    <Button className="w-full bg-success hover:bg-success/90 text-success-foreground" data-testid="button-start-free">
                      Start Free Today
                    </Button>
                  </Link>
                </div>
              </Card>
              </StaggerItem>
              
              <StaggerItem>
              <Card className="p-8 relative h-full" data-testid="card-pricing-coming-soon">
                <Badge variant="outline" className="absolute -top-3 left-1/2 -translate-x-1/2">
                  COMING SOON
                </Badge>
                
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold">On the Roadmap</h3>
                    <p className="mt-4 text-sm text-muted-foreground">
                      We're building more features based on early adopter feedback. Here's what's next:
                    </p>
                  </div>
                  
                  <ul className="space-y-3">
                    {comingSoonFeatures.map((feature, index) => (
                      <li key={index} className="flex items-center gap-3 text-sm text-muted-foreground">
                        <div className="w-4 h-4 rounded-full bg-muted flex items-center justify-center">
                          <Check className="w-3 h-3 text-muted-foreground" />
                        </div>
                        <span>{feature.text}</span>
                      </li>
                    ))}
                  </ul>
                  
                  <p className="text-xs text-muted-foreground pt-4 border-t">
                    Early adopters will be grandfathered into premium features as they launch.
                  </p>
                </div>
              </Card>
              </StaggerItem>
            </StaggerGroup>
          </div>
        </section>
        
        <section className="py-16 lg:py-20" data-testid="section-enterprise">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <Reveal>
            <Card className="p-12 text-center bg-muted/30">
              <h2 className="heading-section mb-4" data-testid="text-enterprise-headline">
                Enterprise & Custom Solutions
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto mb-6">
                Managing more than 10 profiles? We offer custom white-label solutions for agencies and executive teams.
              </p>
              <a href="mailto:founders@thesocialpundit.com" className="inline-flex items-center gap-2 text-primary font-medium hover:underline" data-testid="link-speak-founding-team">
                Speak with our Founding Team <ArrowRight className="w-4 h-4" />
              </a>
            </Card>
            </Reveal>
          </div>
        </section>
      </main>
      
      <SiteFooter />
    </div>
  );
}
