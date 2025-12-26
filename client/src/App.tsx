import { Switch, Route, useLocation } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Skeleton } from "@/components/ui/skeleton";

import LandingPage from "@/pages/landing";
import PricingPage from "@/pages/pricing";
import HowItWorksPage from "@/pages/how-it-works";
import IndustriesPage from "@/pages/industries";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import CompleteRegistrationPage from "@/pages/complete-registration";
import OnboardingPage from "@/pages/onboarding";
import DashboardPage from "@/pages/dashboard";
import DraftsPage from "@/pages/drafts";
import PublishedPage from "@/pages/published";
import AnalyticsPage from "@/pages/analytics";
import SettingsPage from "@/pages/settings";
import NotFound from "@/pages/not-found";

function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-4 p-3 border-b bg-background sticky top-0 z-10">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <ThemeToggle />
          </header>
          <div className="flex-1 overflow-hidden">
            {children}
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}

function DashboardRouter() {
  return (
    <AuthenticatedLayout>
      <Switch>
        <Route path="/dashboard" component={DashboardPage} />
        <Route path="/dashboard/drafts" component={DraftsPage} />
        <Route path="/dashboard/published" component={PublishedPage} />
        <Route path="/dashboard/analytics" component={AnalyticsPage} />
        <Route path="/dashboard/settings" component={SettingsPage} />
        <Route component={DashboardPage} />
      </Switch>
    </AuthenticatedLayout>
  );
}

function AppRoutes() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const [location, setLocation] = useLocation();

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["/api/profile"],
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (isAuthenticated && (location === "/login" || location === "/register")) {
      setLocation("/dashboard");
    }
  }, [isAuthenticated, location, setLocation]);

  const publicRoutes = ["/", "/pricing", "/how-it-works", "/industries", "/login", "/register", "/forgot-password", "/reset-password"];
  const isPublicRoute = publicRoutes.includes(location);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="space-y-4 text-center">
          <Skeleton className="h-12 w-12 rounded-full mx-auto" />
          <Skeleton className="h-4 w-32 mx-auto" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    if (location.startsWith("/dashboard") || location === "/onboarding") {
      return <LandingPage />;
    }
    return (
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/pricing" component={PricingPage} />
        <Route path="/how-it-works" component={HowItWorksPage} />
        <Route path="/industries" component={IndustriesPage} />
        <Route path="/login" component={LoginPage} />
        <Route path="/register" component={RegisterPage} />
        <Route path="/forgot-password" component={ForgotPasswordPage} />
        <Route path="/reset-password" component={ResetPasswordPage} />
        <Route component={LandingPage} />
      </Switch>
    );
  }

  if (isPublicRoute) {
    if (location === "/login" || location === "/register" || location === "/forgot-password") {
      setLocation("/dashboard");
      return null;
    }
    return (
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/pricing" component={PricingPage} />
        <Route path="/how-it-works" component={HowItWorksPage} />
        <Route path="/industries" component={IndustriesPage} />
      </Switch>
    );
  }

  const typedUser = user as { registrationCompleted?: string | null; firstName?: string | null; lastName?: string | null } | null;
  const registrationComplete = !!typedUser?.registrationCompleted;
  const onboardingComplete = (profile as { onboardingStatus?: string })?.onboardingStatus === "completed";

  if (!registrationComplete && !profileLoading) {
    return (
      <CompleteRegistrationPage 
        existingFirstName={typedUser?.firstName} 
        existingLastName={typedUser?.lastName} 
      />
    );
  }

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="space-y-4 text-center">
          <Skeleton className="h-12 w-12 rounded-full mx-auto" />
          <Skeleton className="h-4 w-32 mx-auto" />
        </div>
      </div>
    );
  }

  if (location === "/onboarding" || (!onboardingComplete && location.startsWith("/dashboard"))) {
    return (
      <Switch>
        <Route path="/onboarding" component={OnboardingPage} />
        <Route component={OnboardingPage} />
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/dashboard/:rest*" component={DashboardRouter} />
      <Route path="/dashboard" component={DashboardRouter} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="light" storageKey="socialpundit-theme">
          <TooltipProvider>
            <Toaster />
            <AppRoutes />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

export default App;
