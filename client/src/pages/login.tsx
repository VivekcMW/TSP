import { useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { ArrowLeft, Zap, Loader2 } from "lucide-react";
import { SiGoogle, SiGithub, SiX, SiApple } from "react-icons/si";
import { SEO } from "@/components/seo";

export default function LoginPage() {
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && user) {
      window.location.href = "/dashboard";
    }
  }, [user, isLoading]);

  const handleLogin = () => {
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
        title="Sign In"
        canonical="/login"
        description="Sign in to TheSocialPundit to continue building your professional authority on LinkedIn and Twitter."
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
            <div className="space-y-1 text-center">
              <CardTitle className="text-2xl font-bold">Welcome back</CardTitle>
              <CardDescription>
                Sign in with your preferred account
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={handleLogin}
              className="w-full"
              size="lg"
              data-testid="button-continue-login"
            >
              Continue to Sign In
            </Button>
            
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  Or continue with
                </span>
              </div>
            </div>
            
            <div className="grid grid-cols-4 gap-3">
              <Button
                variant="outline"
                onClick={handleLogin}
                data-testid="button-login-google"
              >
                <SiGoogle className="w-5 h-5" />
              </Button>
              <Button
                variant="outline"
                onClick={handleLogin}
                data-testid="button-login-github"
              >
                <SiGithub className="w-5 h-5" />
              </Button>
              <Button
                variant="outline"
                onClick={handleLogin}
                data-testid="button-login-x"
              >
                <SiX className="w-5 h-5" />
              </Button>
              <Button
                variant="outline"
                onClick={handleLogin}
                data-testid="button-login-apple"
              >
                <SiApple className="w-5 h-5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
