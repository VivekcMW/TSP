import { Linkedin, Zap, Inbox, PenTool, Target, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const features = [
  {
    icon: Linkedin,
    title: "LinkedIn-Based Onboarding",
    description: "Import your professional identity in one click. We understand your expertise, industry, and unique perspective automatically.",
  },
  {
    icon: Inbox,
    title: "Curated Content Inbox",
    description: "Receive a daily feed of 20 hand-picked articles matched to your interests. No noise, just relevant industry news worth sharing.",
  },
  {
    icon: PenTool,
    title: "AI Post Generation",
    description: "Transform any article into an opinionated post in your voice. Choose your platform and tone, then edit and publish.",
  },
  {
    icon: Target,
    title: "Smart Topic Matching",
    description: "Our AI tracks 60+ signals including keywords, influencers, and companies to find content that matters to your audience.",
  },
  {
    icon: Zap,
    title: "5-Minute Workflow",
    description: "From login to publish in under 5 minutes. Review content, generate a post, and share your perspective effortlessly.",
  },
  {
    icon: TrendingUp,
    title: "Learning System",
    description: "The more you use it, the better it gets. Our AI learns from your preferences to improve content recommendations.",
  },
];

export function Features() {
  return (
    <section id="features" className="py-20 md:py-32 bg-card/50">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4" data-testid="text-features-headline">
            Everything You Need to Build Authority
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Stop spending hours searching for content. Let AI curate the news and help you share your expert perspective.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <Card key={index} className="border-0 bg-background/50 hover-elevate" data-testid={`card-feature-${index}`}>
              <CardContent className="p-6">
                <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mb-4">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-lg font-medium mb-2">{feature.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {feature.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
