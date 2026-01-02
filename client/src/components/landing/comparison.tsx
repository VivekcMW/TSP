import { Card, CardContent } from "@/components/ui/card";
import { X, Check, Zap, AlertCircle } from "lucide-react";

const problemItems = [
  "You know you should post, but who has 2 hours?",
  "Staring at blank screens, wondering what to say",
  "Generic AI sounds like everyone else",
  "Industry moves fast, your feed can't wait",
];

const solutionItems = [
  "Login to published post in under 5 minutes",
  "AI curates 80+ sources, matched to your industry",
  "4 tonalities: your voice, your POV, your authority",
  "Real-time RSS feeds, never miss a trend",
];

export function Comparison() {
  return (
    <section className="py-20 lg:py-28" data-testid="section-comparison">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-center mb-4">
          Your expertise is invisible.
        </h2>
        <p className="text-lg text-muted-foreground text-center mb-16 max-w-2xl mx-auto">
          You're great at what you do. But if you're not posting, no one knows. Here's how we fix that.
        </p>
        
        <div className="grid md:grid-cols-2 gap-6 lg:gap-8">
          <Card className="border-0 bg-muted/30">
            <CardContent className="p-6 lg:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-destructive" />
                </div>
              </div>
              <h3 className="text-xl font-semibold mb-4">The Problem</h3>
              <ul className="space-y-3">
                {problemItems.map((item, index) => (
                  <li key={index} className="flex items-start gap-3 text-muted-foreground">
                    <X className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          
          <Card className="border-2 border-primary/30 bg-background">
            <CardContent className="p-6 lg:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                  <Zap className="w-5 h-5 text-primary-foreground" />
                </div>
              </div>
              <h3 className="text-xl font-semibold mb-4">The Solution</h3>
              <ul className="space-y-3">
                {solutionItems.map((item, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
