import { Zap } from "lucide-react";

// Shared full-page branded loader — used while Clerk/auth state, the current
// user record, or the onboarding profile are still resolving.
export function LoadingScreen() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center" data-testid="loading-screen">
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex items-center justify-center w-14 h-14">
          <span className="absolute inset-0 rounded-full border-2 border-primary/20" />
          <span className="absolute inset-0 rounded-full border-2 border-t-primary border-r-transparent border-b-transparent border-l-transparent animate-spin" />
          <Zap className="w-6 h-6 text-primary fill-primary" />
        </div>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}
