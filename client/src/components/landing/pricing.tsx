import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const plans = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Perfect for getting started",
    features: [
      "5 inbox items per day",
      "3 post generations per day",
      "LinkedIn platform",
      "Basic topic matching",
      "Email support",
    ],
    cta: "Get Started",
    popular: false,
  },
  {
    name: "Pro",
    price: "$19",
    period: "per month",
    description: "For serious thought leaders",
    features: [
      "20 inbox items per day",
      "Unlimited post generations",
      "LinkedIn & Twitter/X",
      "Advanced AI matching",
      "Tone customization",
      "Draft scheduling",
      "Priority support",
    ],
    cta: "Start Free Trial",
    popular: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "contact us",
    description: "For teams and agencies",
    features: [
      "Everything in Pro",
      "Multiple team members",
      "Custom integrations",
      "Analytics dashboard",
      "White-label options",
      "Dedicated account manager",
      "SLA guarantee",
    ],
    cta: "Contact Sales",
    popular: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="py-20 md:py-32">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4" data-testid="text-pricing-headline">
            Simple, Transparent Pricing
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Start free and upgrade as you grow. No hidden fees, cancel anytime.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
          {plans.map((plan, index) => (
            <Card 
              key={index} 
              className={`relative ${plan.popular ? "border-primary shadow-lg" : ""}`}
              data-testid={`card-pricing-${plan.name.toLowerCase()}`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground">Most Popular</Badge>
                </div>
              )}
              
              <CardHeader className="text-center pb-4">
                <h3 className="text-xl font-semibold">{plan.name}</h3>
                <div className="mt-4">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-muted-foreground ml-2">/{plan.period}</span>
                </div>
                <p className="text-sm text-muted-foreground mt-2">{plan.description}</p>
              </CardHeader>
              
              <CardContent className="pt-0">
                <ul className="space-y-3">
                  {plan.features.map((feature, featureIndex) => (
                    <li key={featureIndex} className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              
              <CardFooter>
                <a href="/api/login" className="w-full">
                  <Button 
                    variant={plan.popular ? "default" : "outline"} 
                    className="w-full"
                    data-testid={`button-pricing-${plan.name.toLowerCase()}`}
                  >
                    {plan.cta}
                  </Button>
                </a>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
