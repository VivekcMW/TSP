import { useState } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/theme-toggle";
import { ArrowLeft, Mail, Loader2, Zap, CheckCircle } from "lucide-react";
import { SEO } from "@/components/seo";

const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  });

  async function onSubmit(data: ForgotPasswordFormValues) {
    setIsSubmitting(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      setIsSubmitted(true);
      toast({
        title: "Check your email",
        description: "If an account exists with that email, you'll receive password reset instructions.",
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Something went wrong",
        description: "Please try again later.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO 
        title="Forgot Password"
        canonical="/forgot-password"
        description="Reset your TheSocialPundit password. Enter your email to receive password reset instructions."
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
              <CardTitle className="text-2xl font-bold">Forgot your password?</CardTitle>
              <CardDescription>
                Enter your email and we'll send you instructions to reset your password.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {isSubmitted ? (
              <div className="text-center space-y-4 py-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-green-500/10 flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-green-500" />
                </div>
                <div className="space-y-2">
                  <h3 className="font-semibold text-lg" data-testid="text-success-title">Check your email</h3>
                  <p className="text-sm text-muted-foreground">
                    If an account exists with the email you provided, you'll receive password reset instructions shortly.
                  </p>
                </div>
                <Button variant="outline" asChild className="mt-4">
                  <Link href="/login" data-testid="link-return-login">
                    Return to login
                  </Link>
                </Button>
              </div>
            ) : (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isSubmitting}
                    data-testid="button-submit"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Mail className="h-4 w-4 mr-2" />
                        Send reset instructions
                      </>
                    )}
                  </Button>
                </form>
              </Form>
            )}
          </CardContent>
          {!isSubmitted && (
            <CardFooter className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground text-center">
                Remember your password?{" "}
                <Link href="/login">
                  <span className="text-primary underline-offset-4 hover:underline cursor-pointer" data-testid="link-login">
                    Sign in
                  </span>
                </Link>
              </p>
            </CardFooter>
          )}
        </Card>
      </main>
    </div>
  );
}
