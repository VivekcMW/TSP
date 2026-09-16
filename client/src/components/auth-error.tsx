import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, LogOut, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError } from "@/lib/queryClient";
import { signOut } from "@/lib/auth";
import { Reveal } from "@/components/motion/reveal";

/**
 * Shown when the session is valid to Clerk but the app cannot resolve the
 * signed-in user from its own API.
 *
 * Without this screen the gate treated every failure as "registration not
 * completed", pinning the user to the registration form — whose submit hit the
 * same failing endpoint, so there was no way out and no indication of why.
 */

type Copy = {
  title: string;
  description: string;
  canRetry: boolean;
};

function copyFor(error: unknown): Copy {
  const status = error instanceof ApiError ? error.status : undefined;
  const detail = error instanceof Error ? error.message : "";

  if (status === 401) {
    return {
      title: "Your session has expired",
      description: "Sign in again to get back to your dashboard.",
      canRetry: false,
    };
  }

  if (status === 422) {
    return {
      title: "We can't set up your account",
      description:
        detail ||
        "Your sign-in provider didn't give us an email address, which we need to create your account.",
      canRetry: false,
    };
  }

  return {
    title: "We couldn't load your account",
    description: detail || "Something went wrong on our end. Please try again.",
    canRetry: true,
  };
}

export function AuthError({ error }: { error: unknown }) {
  const queryClient = useQueryClient();
  const { title, description, canRetry } = copyFor(error);

  const retry = () => {
    queryClient.refetchQueries({ queryKey: ["/api/me"] });
    queryClient.refetchQueries({ queryKey: ["/api/profile"] });
  };

  return (
    <div className="min-h-[100dvh] bg-background flex items-center justify-center p-4">
      <Reveal className="w-full max-w-md">
        <Card className="w-full" data-testid="auth-error">
        <CardHeader className="text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-destructive" />
          </div>
          <CardTitle className="text-2xl" data-testid="text-auth-error-title">
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {canRetry && (
            <Button onClick={retry} size="lg" data-testid="button-auth-error-retry">
              <RefreshCw className="w-4 h-4 mr-2" />
              Try again
            </Button>
          )}
          <Button
            variant={canRetry ? "outline" : "default"}
            size="lg"
            onClick={() => signOut("/")}
            data-testid="button-auth-error-signout"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign out
          </Button>
        </CardContent>
        </Card>
      </Reveal>
    </div>
  );
}
