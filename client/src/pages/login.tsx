import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/theme-toggle";
import { ArrowLeft, LogIn, Loader2, Zap, FlaskConical } from "lucide-react";
import { SiGoogle, SiLinkedin } from "react-icons/si";
import { SEO } from "@/components/seo";
import { Separator } from "@/components/ui/separator";
import { apiRequest, queryClient } from "@/lib/queryClient";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const { login, isLoggingIn } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [isTestMode, setIsTestMode] = useState(false);
  const [isTestLoggingIn, setIsTestLoggingIn] = useState(false);

  useEffect(() => {
    fetch("/api/test/status")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.testMode) setIsTestMode(true);
      })
      .catch(() => {});
  }, []);

  async function handleTestLogin() {
    setIsTestLoggingIn(true);
    try {
      await apiRequest("POST", "/api/test/login");
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: "Test Mode",
        description: "Logged in as test user",
      });
      setLocation("/dashboard");
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Test login failed",
        description: "Could not log in as test user",
      });
    } finally {
      setIsTestLoggingIn(false);
    }
  }

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(data: LoginFormValues) {
    setError(null);
    try {
      await login(data);
      setLocation("/dashboard");
    } catch (err: any) {
      const message = err?.message || "Login failed. Please try again.";
      setError(message);
      toast({
        variant: "destructive",
        title: "Login failed",
        description: message,
      });
    }
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
                Sign in to your account to continue
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.location.href = "/auth/google"}
                type="button"
                data-testid="button-google-login"
              >
                <SiGoogle className="h-4 w-4 mr-2" />
                Continue with Google
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.location.href = "/auth/linkedin"}
                type="button"
                data-testid="button-linkedin-login"
              >
                <SiLinkedin className="h-4 w-4 mr-2" />
                Continue with LinkedIn
              </Button>
            </div>
            
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <Separator className="w-full" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">
                  Or continue with email
                </span>
              </div>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {error && (
                  <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md" data-testid="text-login-error">
                    {error}
                  </div>
                )}
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="you@example.com"
                          data-testid="input-email"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between gap-2">
                        <FormLabel>Password</FormLabel>
                        <Link href="/forgot-password">
                          <span className="text-sm text-primary hover:underline underline-offset-4 cursor-pointer" data-testid="link-forgot-password">
                            Forgot password?
                          </span>
                        </Link>
                      </div>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="Enter your password"
                          data-testid="input-password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoggingIn}
                  data-testid="button-login"
                >
                  {isLoggingIn ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    <>
                      <LogIn className="h-4 w-4 mr-2" />
                      Sign in
                    </>
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground text-center">
              Don't have an account?{" "}
              <Link href="/register">
                <span className="text-primary underline-offset-4 hover:underline cursor-pointer" data-testid="link-register">
                  Sign up
                </span>
              </Link>
            </p>
            {isTestMode && (
              <>
                <Separator />
                <Button
                  variant="outline"
                  className="w-full border-dashed border-amber-500/50 text-amber-600 dark:text-amber-400"
                  onClick={handleTestLogin}
                  disabled={isTestLoggingIn}
                  data-testid="button-test-login"
                >
                  {isTestLoggingIn ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Logging in...
                    </>
                  ) : (
                    <>
                      <FlaskConical className="h-4 w-4 mr-2" />
                      Quick Test Login
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  Dev mode: Skip auth with pre-configured test user
                </p>
              </>
            )}
          </CardFooter>
        </Card>
      </main>
    </div>
  );
}
