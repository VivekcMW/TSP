import { Card, CardContent } from "@/components/ui/card";
import { X, Check, Zap, AlertCircle } from "lucide-react";

const oldWayItems = [
  "Infinite doomscrolling for ideas",
  "Generic, robotic AI summaries",
  "Hours spent staring at blank drafts",
];

const punditWayItems = [
  "Curated signals, zero noise",
  "Opinion-driven, POV-first content",
  "15 minutes a week for consistency",
];

export function Comparison() {
  return (
    <section className="py-20 lg:py-28" data-testid="section-comparison">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-center mb-16">
          Stop shouting into the void.
        </h2>
        
        <div className="grid md:grid-cols-2 gap-6 lg:gap-8">
          <Card className="border-0 bg-muted/30">
            <CardContent className="p-6 lg:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-destructive" />
                </div>
              </div>
              <h3 className="text-xl font-semibold mb-4">The Old Way</h3>
              <ul className="space-y-3">
                {oldWayItems.map((item, index) => (
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
              <h3 className="text-xl font-semibold mb-4">The Pundit Way</h3>
              <ul className="space-y-3">
                {punditWayItems.map((item, index) => (
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
