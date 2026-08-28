import { Card, CardContent } from "@/components/ui/card";
import { Rocket, TrendingUp, Users, Briefcase } from "lucide-react";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";

const roles = [
  {
    icon: Rocket,
    title: "Founders & Executives",
    description: "Too busy running your company to post? We curate what matters, you just add your take.",
  },
  {
    icon: TrendingUp,
    title: "Industry Leaders",
    description: "Stay ahead of industry shifts. Be the voice people turn to for what's next.",
  },
  {
    icon: Users,
    title: "Consultants & Coaches",
    description: "Bill hours and build your brand. No more choosing one or the other.",
  },
  {
    icon: Briefcase,
    title: "Subject Matter Experts",
    description: "Showcase your thinking daily. Let your expertise work for you 24/7.",
  },
];

export function UseCases() {
  return (
    <section className="py-20 lg:py-28" data-testid="section-use-cases">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal>
          <h2 className="heading-section text-center mb-4">
            Built for busy professionals.
          </h2>
          <p className="text-lg text-muted-foreground text-center mb-16 max-w-2xl mx-auto">
            You're the expert in your field. Let's make sure everyone knows it.
          </p>
        </Reveal>
        
        <StaggerGroup className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {roles.map((role, index) => (
            <StaggerItem key={index}>
              <Card className="border-0 bg-muted/30 hover-elevate hover-lift h-full" data-testid={`card-role-${index}`}>
                <CardContent className="p-6">
                  <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center mb-4">
                    <role.icon className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{role.title}</h3>
                  <p className="text-sm text-muted-foreground">{role.description}</p>
                </CardContent>
              </Card>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </div>
    </section>
  );
}
