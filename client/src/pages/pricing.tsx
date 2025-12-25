import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

const starterFeatures = [
  { text: "5 Insight Items per day", included: true },
  { text: "10 AI generations / mo", included: true },
  { text: "Basic Tones (Professional)", included: true },
  { text: "Advanced Scheduling", included: false },
];

const professionalFeatures = [
  { text: "Full Social Inbox Access", included: true },
  { text: "Unlimited Post Generations", included: true },
  { text: "Advanced Tones (Contrarian)", included: true },
  { text: "One-Click Scheduling", included: true },
  { text: "Analytics Dashboard", included: true },
];

const teamFeatures = [
  { text: "Up to 5 Authority Profiles", included: true },
  { text: "Shared Insight Feed", included: true },
  { text: "Dedicated Support Manager", included: true },
  { text: "Custom API Integrations", included: true },
];

export default function Pricing() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SiteHeader />
      
      <main className="flex-1">
        <section className="py-20 lg:py-28" data-testid="section-pricing">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6" data-testid="text-pricing-headline">
                Simple, Value-Based Pricing.
              </h1>
              <p className="text-lg text-muted-foreground max-w-xl mx-auto">
                Scale your professional authority without the complexity. Choose the plan that fits your growth goals.
              </p>
            </div>
            
            <div className="grid md:grid-cols-3 gap-8 items-start">
              <Card className="p-8 relative" data-testid="card-pricing-starter">
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold">Starter</h3>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-4xl font-bold">$0</span>
                      <span className="text-muted-foreground">/mo</span>
                    </div>
                    <p className="mt-4 text-sm text-muted-foreground">
                      Ideal for professionals testing the waters of consistent posting.
                    </p>
                  </div>
                  
                  <ul className="space-y-3">
                    {starterFeatures.map((feature, index) => (
                      <li key={index} className="flex items-center gap-3 text-sm">
                        <div className={`w-4 h-4 rounded-full flex items-center justify-center ${feature.included ? 'bg-muted' : 'bg-muted'}`}>
                          {feature.included ? (
                            <Check className="w-3 h-3 text-muted-foreground" />
                          ) : (
                            <span className="w-2 h-0.5 bg-muted-foreground/50" />
                          )}
                        </div>
                        <span className={feature.included ? '' : 'line-through text-muted-foreground'}>
                          {feature.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                  
                  <Button variant="outline" className="w-full" data-testid="button-start-free">
                    Start for Free
                  </Button>
                </div>
              </Card>
              
              <Card className="p-8 relative bg-slate-900 dark:bg-slate-950 text-white border-slate-800" data-testid="card-pricing-professional">
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                  MOST POPULAR
                </Badge>
                
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold">Professional</h3>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-4xl font-bold">$49</span>
                      <span className="text-slate-400">/mo</span>
                    </div>
                    <p className="mt-4 text-sm text-slate-400">
                      For founders, leaders, and consultants building a serious personal brand.
                    </p>
                  </div>
                  
                  <ul className="space-y-3">
                    {professionalFeatures.map((feature, index) => (
                      <li key={index} className="flex items-center gap-3 text-sm">
                        <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                          <Check className="w-3 h-3 text-primary-foreground" />
                        </div>
                        <span>{feature.text}</span>
                      </li>
                    ))}
                  </ul>
                  
                  <Button className="w-full" data-testid="button-unlock-full-access">
                    Unlock Full Access
                  </Button>
                </div>
              </Card>
              
              <Card className="p-8 relative" data-testid="card-pricing-team">
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold">Team / Creator</h3>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-4xl font-bold">$199</span>
                      <span className="text-muted-foreground">/mo</span>
                    </div>
                    <p className="mt-4 text-sm text-muted-foreground">
                      For agencies or corporate teams managing multiple authority profiles.
                    </p>
                  </div>
                  
                  <ul className="space-y-3">
                    {teamFeatures.map((feature, index) => (
                      <li key={index} className="flex items-center gap-3 text-sm">
                        <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center">
                          <Check className="w-3 h-3 text-primary" />
                        </div>
                        <span>{feature.text}</span>
                      </li>
                    ))}
                  </ul>
                  
                  <Button variant="outline" className="w-full" data-testid="button-contact-sales">
                    Contact Sales
                  </Button>
                </div>
              </Card>
            </div>
          </div>
        </section>
        
        <section className="py-16 lg:py-20" data-testid="section-enterprise">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <Card className="p-12 text-center bg-muted/30">
              <h2 className="text-2xl sm:text-3xl font-bold mb-4" data-testid="text-enterprise-headline">
                Enterprise & Custom Solutions
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto mb-6">
                Managing more than 10 profiles? We offer custom white-label solutions for agencies and executive teams.
              </p>
              <a href="mailto:founders@thesocialpundit.com" className="inline-flex items-center gap-2 text-primary font-medium hover:underline" data-testid="link-speak-founding-team">
                Speak with our Founding Team <ArrowRight className="w-4 h-4" />
              </a>
            </Card>
          </div>
        </section>
      </main>
      
      <SiteFooter />
    </div>
  );
}
