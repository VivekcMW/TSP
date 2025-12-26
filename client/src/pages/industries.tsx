import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { SEO } from "@/components/seo";
import { Megaphone, Building2, Stethoscope, Landmark, ShoppingBag, Cpu, Check, ArrowRight } from "lucide-react";

const industries = [
  {
    icon: Megaphone,
    title: "Media & Advertising",
    available: true,
    description: "Stay ahead of trends in digital marketing, programmatic ads, and brand strategy. Perfect for marketing directors, media planners, and agency professionals.",
    features: [
      "Ad tech and martech updates",
      "Platform algorithm changes",
      "Campaign performance insights",
      "Industry trends and reports",
      "Agency news and acquisitions",
      "Brand strategy developments",
    ],
  },
  {
    icon: Cpu,
    title: "Technology",
    available: false,
    description: "AI, cloud computing, developer tools, and enterprise software news for tech leaders and innovators.",
    features: [],
  },
  {
    icon: Landmark,
    title: "Finance & Fintech",
    available: false,
    description: "Banking, payments, crypto, and financial services innovation for finance professionals.",
    features: [],
  },
  {
    icon: Stethoscope,
    title: "Healthcare",
    available: false,
    description: "Digital health, biotech, and healthcare policy developments for medical and pharma professionals.",
    features: [],
  },
  {
    icon: ShoppingBag,
    title: "E-commerce & Retail",
    available: false,
    description: "DTC brands, marketplaces, and retail technology trends for commerce leaders.",
    features: [],
  },
  {
    icon: Building2,
    title: "Real Estate",
    available: false,
    description: "PropTech, commercial real estate, and market analysis for property professionals.",
    features: [],
  },
];

export default function IndustriesPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO 
        title="Industries"
        canonical="/industries"
        description="TheSocialPundit supports professionals across multiple industries. Currently available for Media & Advertising, with more industries coming soon."
      />
      <SiteHeader />
      <main className="flex-1">
        <section className="py-16 lg:py-24" data-testid="section-industries-hero">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-6" data-testid="text-industries-title">
              Built for your industry
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              TheSocialPundit curates news and insights tailored to your specific field, so every post you create is relevant and timely.
            </p>
          </div>
        </section>

        <section className="pb-20 lg:pb-28" data-testid="section-industries-grid">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {industries.map((industry, index) => (
                <Card 
                  key={index} 
                  className={`border ${industry.available ? 'border-primary/30 bg-background' : 'border-border bg-muted/20 opacity-75'}`}
                  data-testid={`card-industry-${index}`}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div className={`w-12 h-12 rounded-md flex items-center justify-center flex-shrink-0 ${industry.available ? 'bg-primary/10' : 'bg-muted'}`}>
                        <industry.icon className={`w-6 h-6 ${industry.available ? 'text-primary' : 'text-muted-foreground'}`} />
                      </div>
                      {industry.available ? (
                        <Badge variant="default" className="text-xs" data-testid="badge-available">
                          Available
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs" data-testid="badge-coming-soon">
                          Coming Soon
                        </Badge>
                      )}
                    </div>
                    <h3 className="text-lg font-semibold mb-2">{industry.title}</h3>
                    <p className="text-sm text-muted-foreground mb-4">{industry.description}</p>
                    
                    {industry.available && industry.features.length > 0 && (
                      <ul className="space-y-2 mb-6">
                        {industry.features.map((feature, fIndex) => (
                          <li key={fIndex} className="flex items-start gap-2 text-sm">
                            <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {industry.available && (
                      <Link href="/register">
                        <Button className="w-full" data-testid="button-get-started">
                          Get Started
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      </Link>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16 lg:py-20 bg-muted/30" data-testid="section-industries-cta">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold mb-4">
              Don't see your industry?
            </h2>
            <p className="text-muted-foreground mb-6">
              We're adding new industries regularly. Sign up to be notified when we launch support for your field.
            </p>
            <Link href="/register">
              <Button size="lg" data-testid="button-notify-me">
                Join the waitlist
              </Button>
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
