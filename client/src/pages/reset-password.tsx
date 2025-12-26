import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/theme-toggle";
import { ArrowLeft, Loader2, Zap, CheckCircle, XCircle, Lock } from "lucide-react";
import { SEO } from "@/components/seo";

const resetPasswordSchema = z.object({
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string().min(6, "Password must be at least 6 characters"),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

export default function ResetPasswordPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isValidToken, setIsValidToken] = useState<boolean | null>(null);
  const [isCheckingToken, setIsCheckingToken] = useState(true);

  const searchParams = new URLSearchParams(window.location.search);
  const token = searchParams.get("token");

  useEffect(() => {
    if (!token) {
      setIsValidToken(false);
      setIsCheckingToken(false);
      return;
    }

    fetch(`/api/auth/verify-reset-token?token=${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data) => {
        setIsValidToken(data.valid);
      })
      .catch(() => {
        setIsValidToken(false);
      })
      .finally(() => {
        setIsCheckingToken(false);
      });
  }, [token]);

  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(data: ResetPasswordFormValues) {
    if (!token) return;
    
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: data.password }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to reset password");
      }

      setIsSuccess(true);
      toast({
        title: "Password reset successful",
        description: "You can now log in with your new password.",
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Reset failed",
        description: err.message || "Please try again or request a new reset link.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isCheckingToken) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <SEO title="Reset Password" canonical="/reset-password" />
        <header className="flex items-center justify-between gap-4 p-4 border-b">
          <Link href="/login">
            <Button variant="ghost" size="sm" data-testid="link-back-login">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to login
            </Button>
          </Link>
          <ThemeToggle />
        </header>
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Verifying reset link...</span>
          </div>
        </main>
      </div>
    );
  }

  if (!isValidToken) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <SEO title="Invalid Reset Link" canonical="/reset-password" />
        <header className="flex items-center justify-between gap-4 p-4 border-b">
          <Link href="/login">
            <Button variant="ghost" size="sm" data-testid="link-back-login">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to login
            </Button>
          </Link>
          <ThemeToggle />
        </header>
        <main className="flex-1 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-destructive/10 flex items-center justify-center">
                <XCircle className="w-8 h-8 text-destructive" />
              </div>
              <div className="space-y-1">
                <CardTitle className="text-2xl font-bold" data-testid="text-invalid-title">Invalid or expired link</CardTitle>
                <CardDescription>
                  This password reset link is invalid or has expired. Please request a new one.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button asChild>
                <Link href="/forgot-password" data-testid="link-request-new">
                  Request new reset link
                </Link>
              </Button>
              <Button variant="ghost" asChild>
                <Link href="/login" data-testid="link-login">
                  Back to login
                </Link>
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <SEO title="Password Reset Successful" canonical="/reset-password" />
        <header className="flex items-center justify-between gap-4 p-4 border-b">
          <Link href="/login">
            <Button variant="ghost" size="sm" data-testid="link-back-login">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to login
            </Button>
          </Link>
          <ThemeToggle />
        </header>
        <main className="flex-1 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-green-500/10 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-green-500" />
              </div>
              <div className="space-y-1">
                <CardTitle className="text-2xl font-bold" data-testid="text-success-title">Password reset successful</CardTitle>
                <CardDescription>
                  Your password has been changed. You can now log in with your new password.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <Button className="w-full" asChild>
                <Link href="/login" data-testid="link-login-success">
                  Go to login
                </Link>
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO 
        title="Reset Password"
        canonical="/reset-password"
        description="Create a new password for your TheSocialPundit account."
      />
      <header className="flex items-center justify-between gap-4 p-4 border-b">
        <Link href="/login">
          <Button variant="ghost" size="sm" data-testid="link-back-login">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to login
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
              <CardTitle className="text-2xl font-bold">Create new password</CardTitle>
              <CardDescription>
                Enter your new password below.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="Enter new password"
                          data-testid="input-password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="Confirm new password"
                          data-testid="input-confirm-password"
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
                  disabled={isSubmitting}
                  data-testid="button-submit"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Resetting...
                    </>
                  ) : (
                    <>
                      <Lock className="h-4 w-4 mr-2" />
                      Reset password
                    </>
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
