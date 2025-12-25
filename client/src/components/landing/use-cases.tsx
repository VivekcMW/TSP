import { Card, CardContent } from "@/components/ui/card";
import { Rocket, TrendingUp, Users, Briefcase } from "lucide-react";

const roles = [
  {
    icon: Rocket,
    title: "Founders",
    description: "Build investor trust & attract top-tier talent effortlessly.",
  },
  {
    icon: TrendingUp,
    title: "Sales Leaders",
    description: "Warm up outbound leads with deep domain authority.",
  },
  {
    icon: Users,
    title: "Consultants",
    description: "Keep your inbound pipeline full while billing hours.",
  },
  {
    icon: Briefcase,
    title: "Job Seekers",
    description: "Showcase hired-state expertise to recruiters 24/7.",
  },
];

export function UseCases() {
  return (
    <section className="py-20 lg:py-28" data-testid="section-use-cases">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-center mb-16">
          Designed for high-impact roles.
        </h2>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {roles.map((role, index) => (
            <Card key={index} className="border-0 bg-muted/30 hover-elevate" data-testid={`card-role-${index}`}>
              <CardContent className="p-6">
                <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center mb-4">
                  <role.icon className="w-6 h-6 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{role.title}</h3>
                <p className="text-sm text-muted-foreground">{role.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
