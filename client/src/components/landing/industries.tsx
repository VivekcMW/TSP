import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Megaphone, Building2, Stethoscope, Landmark, ShoppingBag, Cpu, Check } from "lucide-react";

const industries = [
  {
    icon: Megaphone,
    title: "Media & Advertising",
    available: true,
    description: "Stay ahead of trends in digital marketing, programmatic ads, and brand strategy.",
    features: [
      "Ad tech and martech updates",
      "Platform algorithm changes",
      "Campaign performance insights",
      "Industry trends and reports",
    ],
  },
  {
    icon: Cpu,
    title: "Technology",
    available: false,
    description: "AI, cloud computing, developer tools, and enterprise software news.",
    features: [],
  },
  {
    icon: Landmark,
    title: "Finance & Fintech",
    available: false,
    description: "Banking, payments, crypto, and financial services innovation.",
    features: [],
  },
  {
    icon: Stethoscope,
    title: "Healthcare",
    available: false,
    description: "Digital health, biotech, and healthcare policy developments.",
    features: [],
  },
  {
    icon: ShoppingBag,
    title: "E-commerce & Retail",
    available: false,
    description: "DTC brands, marketplaces, and retail technology trends.",
    features: [],
  },
  {
    icon: Building2,
    title: "Real Estate",
    available: false,
    description: "PropTech, commercial real estate, and market analysis.",
    features: [],
  },
];

export function Industries() {
  return (
    <section className="py-20 lg:py-28 bg-muted/30" data-testid="section-industries">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            Built for your industry.
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            TheSocialPundit curates news and insights tailored to your specific field, so every post you create is relevant and timely.
          </p>
        </div>
        
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
                  <ul className="space-y-2">
                    {industry.features.map((feature, fIndex) => (
                      <li key={fIndex} className="flex items-start gap-2 text-sm">
                        <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
