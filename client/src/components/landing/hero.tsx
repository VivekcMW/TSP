import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function Hero() {
  return (
    <section className="relative min-h-[85vh] flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/10" />
      <div className="absolute top-20 left-10 w-72 h-72 bg-primary/10 rounded-full blur-3xl" />
      <div className="absolute bottom-20 right-10 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
      
      <div className="relative max-w-7xl mx-auto px-6 py-20 text-center">
        <Badge variant="secondary" className="mb-6 px-4 py-2">
          <Sparkles className="w-3 h-3 mr-2" />
          AI-Powered Thought Leadership
        </Badge>
        
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight mb-6 max-w-4xl mx-auto leading-tight" data-testid="text-hero-headline">
          Build Your Authority on{" "}
          <span className="text-primary">LinkedIn & Twitter</span>
        </h1>
        
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed" data-testid="text-hero-subtext">
          TheSocialPundit curates relevant industry content and transforms it into 
          opinionated posts written in your unique voice. Build your personal brand 
          in under 5 minutes a day.
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <a href="/api/login">
            <Button size="lg" className="px-8" data-testid="button-cta-primary">
              Get Started Free
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </a>
          <a href="#features">
            <Button variant="outline" size="lg" className="px-8" data-testid="button-cta-secondary">
              See How It Works
            </Button>
          </a>
        </div>
        
        <div className="mt-16 flex flex-wrap justify-center gap-8 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-status-online rounded-full" />
            <span>No credit card required</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-status-online rounded-full" />
            <span>Setup in 60 seconds</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-status-online rounded-full" />
            <span>Cancel anytime</span>
          </div>
        </div>
      </div>
    </section>
  );
}
