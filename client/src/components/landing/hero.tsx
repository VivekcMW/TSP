import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Zap } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";

export function Hero() {
  const { user } = useAuth();

  return (
    <section className="py-20 lg:py-28" data-testid="section-hero">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div className="space-y-8">
            <Badge variant="secondary" className="text-xs font-semibold tracking-wider uppercase px-3 py-1.5">
              AI-Driven Authority Engine
            </Badge>
            
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-tight" data-testid="text-hero-headline">
              Turn News into{" "}
              <span className="text-primary">Thought Leadership</span>.
            </h1>
            
            <p className="text-lg text-muted-foreground max-w-lg" data-testid="text-hero-subtext">
              TheSocialPundit scans your industry's news and drafts high-signal social posts in your unique voice. Build your professional narrative in minutes, not hours.
            </p>
            
            <div className="flex flex-wrap items-center gap-4">
              {user ? (
                <Link href="/dashboard">
                  <Button size="lg" data-testid="button-dashboard">
                    Go to Dashboard
                  </Button>
                </Link>
              ) : (
                <>
                  <a href="/api/login">
                    <Button size="lg" data-testid="button-cta-primary">
                      Get Started Free
                    </Button>
                  </a>
                  <a href="#how-it-works">
                    <Button variant="outline" size="lg" data-testid="button-cta-secondary">
                      See How It Works
                    </Button>
                  </a>
                </>
              )}
            </div>
          </div>
          
          <div className="relative">
            <Card className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
                  <Zap className="w-4 h-4 text-primary-foreground" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Social Inbox</p>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Matched to your profile</p>
                </div>
              </div>
              
              <div className="space-y-3">
                <div className="p-4 bg-muted/50 rounded-md">
                  <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                    <span className="text-xs font-medium text-primary uppercase tracking-wide">TechCrunch</span>
                    <span className="text-xs text-muted-foreground">Just Now</span>
                  </div>
                  <p className="text-sm font-medium">Stripe unbundles its payment stack...</p>
                </div>
                
                <div className="flex justify-center py-2">
                  <div className="w-6 h-6 rounded-full border-2 border-muted flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-muted-foreground"></div>
                  </div>
                </div>
                
                <div className="p-4 bg-primary/10 rounded-md border border-primary/20">
                  <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">AI Drafted POV</p>
                  <p className="text-sm italic text-foreground/80">
                    "Stripe isn't just unbundling; they're commoditizing the competition. The next phase of Fintech won't be about infrastructure, it will be about the distribution layer..."
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}
