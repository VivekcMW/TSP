import { useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { ArrowLeft, Zap, Loader2, Check } from "lucide-react";
import { SiGoogle, SiGithub, SiX, SiApple } from "react-icons/si";
import { SEO } from "@/components/seo";

const benefits = [
  "10 curated articles per day",
  "Unlimited AI post generations",
  "All 4 tonality styles",
  "LinkedIn + Twitter/X support",
];

export default function RegisterPage() {
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && user) {
      window.location.href = "/dashboard";
    }
  }, [user, isLoading]);

  const handleSignUp = () => {
    window.location.href = "/api/login";
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO 
        title="Create Account"
        canonical="/register"
        description="Create your TheSocialPundit account and start building your professional authority on LinkedIn and Twitter with AI-powered content."
      />
      <header className="flex items-center justify-between gap-4 p-4 border-b">
        <Link href="/">
          <Button variant="ghost" size="sm" data-testid="link-back-home">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to home
          </Button>
        </Link>
        <ThemeToggle />
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-4">
            <Link href="/">
              <div className="flex items-center justify-center gap-2 cursor-pointer" data-testid="link-logo-header">
                <Zap className="w-8 h-8 text-primary fill-primary" />
                <span className="font-bold text-2xl text-primary">TheSocialPundit</span>
              </div>
            </Link>
            <div className="space-y-2 text-center">
              <Badge className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20">
                FREE for Early Adopters
              </Badge>
              <CardTitle className="text-2xl font-bold">Start building authority</CardTitle>
              <CardDescription>
                Create your account in seconds
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <ul className="space-y-2">
              {benefits.map((benefit, index) => (
                <li key={index} className="flex items-center gap-2 text-sm">
                  <div className="w-4 h-4 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                    <Check className="w-2.5 h-2.5 text-green-600 dark:text-green-400" />
                  </div>
                  <span className="text-muted-foreground">{benefit}</span>
                </li>
              ))}
            </ul>
            
            <Button
              onClick={handleSignUp}
              className="w-full bg-green-500 hover:bg-green-600"
              size="lg"
              data-testid="button-start-free"
            >
              Start Free with One Click
            </Button>
            
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  Sign up with
                </span>
              </div>
            </div>
            
            <div className="flex justify-center gap-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <SiGoogle className="w-5 h-5" />
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <SiGithub className="w-5 h-5" />
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <SiX className="w-5 h-5" />
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <SiApple className="w-5 h-5" />
              </div>
            </div>
            
            <p className="text-xs text-muted-foreground text-center">
              Continue with Google, GitHub, X, Apple, or email
            </p>
            
            <p className="text-sm text-muted-foreground text-center">
              Already have an account?{" "}
              <Link href="/login">
                <span className="text-primary underline-offset-4 hover:underline cursor-pointer" data-testid="link-login">
                  Sign in
                </span>
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
