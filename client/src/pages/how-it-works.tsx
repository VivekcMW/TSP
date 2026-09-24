import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { PLATFORMS } from "@/lib/platforms";
import { Reveal } from "@/components/motion/reveal";
import { fadeUp } from "@/lib/motion";

export default function HowItWorks() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO 
        title="How It Works"
        canonical="/how-it-works"
        description="Learn how TheSocialPundit automates your professional narrative. From AI-powered content curation to one-click publishing across 23 platforms, including LinkedIn, Twitter/X, Reddit, Mastodon, Weibo, and developer blogs like Dev.to and Hashnode."
      />
      <SiteHeader />
      
      <main className="flex-1">
        <section className="py-20 lg:py-28 bg-muted/30" data-testid="section-how-it-works">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-20">
              <Reveal variants={fadeUp}>
              <h1 className="heading-display mb-6" data-testid="text-how-it-works-headline">
                Automate your professional narrative.
              </h1>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
                TheSocialPundit is an intelligence layer that sits between global industry news and your professional social presence.
              </p>
              <Link href="/sign-up" data-testid="link-get-started-how-it-works">
                <Button size="lg" data-testid="button-get-started-how-it-works">Get Started Free</Button>
              </Link>
              </Reveal>
            </div>
            
            <div className="space-y-24">
              <Reveal variants={fadeUp}>
              <div className="grid lg:grid-cols-2 gap-12 items-center" data-testid="section-step-1">
                <div className="space-y-6">
                  <p className="text-sm font-semibold text-primary uppercase tracking-wide">Step 1</p>
                  <h2 className="heading-section">Tell us who you are.</h2>
                  <p className="text-muted-foreground">
                    Skip the long forms. Provide a few sentences about your role and interests. Our AI infers your professional identity, target audience, and the narrative pillars that define your expertise.
                  </p>
                  <ul className="space-y-3">
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-primary" />
                      <span>Minimal manual input required</span>
                    </li>
                    <li className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-primary" />
                      <span>AI-generated interest map</span>
                    </li>
                  </ul>
                </div>
                <Card className="p-6 bg-background">
                  <p className="text-sm italic text-muted-foreground mb-4">
                    "I'm a VP of Product at a scaling Fintech. I care about cross-border payments, regulatory shifts, and product-led growth."
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">Fintech</Badge>
                    <Badge variant="outline">B2B Payments</Badge>
                    <Badge variant="outline">Leadership</Badge>
                  </div>
                </Card>
              </div>
              </Reveal>
              
              <Reveal variants={fadeUp}>
              <div className="grid lg:grid-cols-2 gap-12 items-center" data-testid="section-step-2">
                <Card className="p-0 bg-surface-ink text-surface-ink-foreground order-2 lg:order-1 overflow-hidden">
                  <div className="p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2 p-3 bg-surface-ink-foreground/10 rounded-md flex-wrap">
                      <span className="text-xs font-semibold text-secondary uppercase">TechCrunch</span>
                      <span className="text-xs opacity-70">2m ago</span>
                    </div>
                    <p className="text-sm px-3">Stripe expands to 5 new markets in SE Asia.</p>
                    
                    <div className="flex items-center justify-between gap-2 p-3 bg-surface-ink-foreground/10 rounded-md flex-wrap">
                      <span className="text-xs font-semibold text-secondary uppercase">WSJ</span>
                      <span className="text-xs opacity-70">9h ago</span>
                    </div>
                    <p className="text-sm px-3">New regulatory framework for stablecoins proposed.</p>
                  </div>
                </Card>
                <div className="space-y-6 order-1 lg:order-2">
                  <p className="text-sm font-semibold text-primary uppercase tracking-wide">Step 2</p>
                  <h2 className="heading-section">Your Social Inbox comes alive.</h2>
                  <p className="text-muted-foreground">
                    We monitor 80+ trusted industry publications — from Tier 1 outlets to specialized journals—and surface only the articles that align with your narrative. No noise, no scrolling.
                  </p>
                </div>
              </div>
              </Reveal>
              
              <Reveal variants={fadeUp}>
              <div className="grid lg:grid-cols-2 gap-12 items-center" data-testid="section-step-3">
                <div className="space-y-6">
                  <p className="text-sm font-semibold text-primary uppercase tracking-wide">Step 3</p>
                  <h2 className="heading-section">AI drafts insights in your POV.</h2>
                  <p className="text-muted-foreground">
                    The platform doesn't just summarize news; it injects your unique perspective. Whether you want to challenge industry norms or provide deep analysis, the AI drafts high-signal posts ready for your final touch.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Badge className="bg-destructive/10 text-destructive border-0">Contrarian</Badge>
                    <Badge className="bg-primary/10 text-primary border-0">Authoritative</Badge>
                  </div>
                </div>
                <Card className="p-6 bg-background">
                  <p className="text-sm italic">
                    "Most people look at the new stablecoin regulation as a hurdle. I see it as the final brick in the bridge between DeFi and Enterprise. If you're not planning for a regulated crypto-stack by 2025, you're already behind."
                  </p>
                </Card>
              </div>
              </Reveal>
              
              <Reveal variants={fadeUp}>
              <div className="grid lg:grid-cols-2 gap-12 items-center" data-testid="section-step-4">
                <Card className="p-6 bg-background order-2 lg:order-1">
                  <div className="grid grid-cols-4 gap-4">
                    {PLATFORMS.map((p) => (
                      <div key={p.value} className="flex flex-col items-center gap-2">
                        <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center">
                          <p.icon className="w-5 h-5" />
                        </div>
                        <span className="text-xs text-center text-muted-foreground">{p.label}</span>
                      </div>
                    ))}
                  </div>
                </Card>
                <div className="space-y-6 order-1 lg:order-2">
                  <p className="text-sm font-semibold text-primary uppercase tracking-wide">Step 4</p>
                  <h2 className="heading-section">Publish with one click.</h2>
                  <p className="text-muted-foreground">
                    Schedule your posts or publish instantly across 23 platforms — from LinkedIn and Twitter/X to Reddit, Mastodon, regional networks, and developer blogs. Stay consistent without spending hours on content creation. Your authority builds while you focus on your core work.
                  </p>
                </div>
              </div>
              </Reveal>
            </div>
          </div>
        </section>
      </main>
      
      <SiteFooter />
    </div>
  );
}
