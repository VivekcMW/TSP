import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CTA() {
  return (
    <section className="py-20 md:py-32 bg-primary/5">
      <div className="max-w-4xl mx-auto px-6 text-center">
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4" data-testid="text-cta-headline">
          Ready to Build Your Authority?
        </h2>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
          Join thousands of professionals who are establishing themselves as thought leaders with TheSocialPundit.
        </p>
        <a href="/api/login">
          <Button size="lg" className="px-8" data-testid="button-cta-final">
            Start Free Today
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </a>
      </div>
    </section>
  );
}
