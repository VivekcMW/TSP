import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";

export function AIPov() {
  return (
    <section className="py-20 lg:py-28 bg-muted/30" data-testid="section-ai-pov">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <Badge className="mb-4 bg-primary/10 text-primary border-0">
            <Sparkles className="w-3 h-3 mr-1" />
            Powered by Gemini 2.5 Flash
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            Your voice. Your POV. Not generic AI slop.
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Our AI reads real articles from 80+ industry publications, understands context, and generates posts in 4 distinct tonalities. Choose Thought Leader, Industry Insider, Provocateur, or Data-Driven.
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 gap-6 lg:gap-8">
          <Card className="border-0 bg-background/50">
            <CardContent className="p-6 lg:p-8">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-4">
                Generic AI Response
              </p>
              <p className="text-muted-foreground line-through mb-6">
                "This article discusses the new regulatory framework for stablecoins. It mentions that compliance is important for the future of the industry..."
              </p>
              <Badge variant="outline" className="text-destructive border-destructive/30">
                Result: Ignored
              </Badge>
            </CardContent>
          </Card>
          
          <Card className="border-2 border-primary/30 bg-background">
            <CardContent className="p-6 lg:p-8">
              <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-4">
                Social Pundit POV
              </p>
              <p className="mb-6">
                "The new stablecoin framework isn't a hurdle—it's the green light institutional capital has been waiting for. If you're building for DeFi without a 2025 compliance roadmap, you're not building a business, you're building a liability."
              </p>
              <Badge className="bg-primary/10 text-primary border-0">
                Result: 50+ Comments
              </Badge>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
