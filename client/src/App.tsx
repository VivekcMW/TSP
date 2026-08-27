import { useEffect, useRef } from "react";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ClerkProvider, SignIn, SignUp, useClerk, useUser } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Skeleton } from "@/components/ui/skeleton";
import type { User as DbUser } from "@shared/models/auth";

import LandingPage from "@/pages/landing";
import PricingPage from "@/pages/pricing";
import HowItWorksPage from "@/pages/how-it-works";
import IndustriesPage from "@/pages/industries";
import CompleteRegistrationPage from "@/pages/complete-registration";
import OnboardingPage from "@/pages/onboarding";
import DashboardPage from "@/pages/dashboard";
import DraftsPage from "@/pages/drafts";
import PublishedPage from "@/pages/published";
import AnalyticsPage from "@/pages/analytics";
import SettingsPage from "@/pages/settings";
import ProfileSettingsPage from "@/pages/profile-settings";
import NotFound from "@/pages/not-found";

// REQUIRED — copy verbatim. Resolves the key from window.location.hostname so the
// same build serves multiple Clerk custom domains. Do not inline the env var, leave
// publishableKey undefined, or replace publishableKeyFromHost with anything else.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// REQUIRED — copy verbatim. Empty in dev (Clerk hits dev FAPI directly), auto-set
// in prod. Do NOT gate on import.meta.env.PROD / NODE_ENV — the empty dev value
// is intentional, and any branching breaks the prod proxy.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Clerk passes full paths to routerPush/routerReplace, but wouter's
// setLocation prepends the base — strip it to avoid doubling.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  theme: shadcn,
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(262, 83%, 58%)",
    colorForeground: "hsl(240, 6%, 10%)",
    colorMutedForeground: "hsl(240, 4%, 46%)",
    colorDanger: "hsl(0, 84%, 45%)",
    colorBackground: "hsl(0, 0%, 100%)",
    colorInput: "hsl(0, 0%, 100%)",
    colorInputForeground: "hsl(240, 6%, 10%)",
    colorNeutral: "hsl(240, 5%, 88%)",
    fontFamily: "Inter, system-ui, sans-serif",
    borderRadius: ".5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white border border-[hsl(240,5%,92%)] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-lg",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[hsl(240,6%,10%)] text-xl font-semibold",
    headerSubtitle: "text-[hsl(240,4%,46%)]",
    socialButtonsBlockButtonText: "text-[hsl(240,6%,10%)] font-medium",
    formFieldLabel: "text-[hsl(240,6%,10%)] font-medium",
    footerActionLink: "text-[hsl(262,83%,58%)] font-medium hover:opacity-90",
    footerActionText: "text-[hsl(240,4%,46%)]",
    dividerText: "text-[hsl(240,4%,46%)]",
    identityPreviewEditButton: "text-[hsl(262,83%,58%)]",
    formFieldSuccessText: "text-[hsl(240,6%,10%)]",
    alertText: "text-[hsl(240,6%,10%)]",
    logoBox: "flex justify-center mb-2",
    logoImage: "h-8 w-8",
    socialButtonsBlockButton: "border border-[hsl(240,5%,88%)] hover:bg-[hsl(251,92%,96%)]",
    formButtonPrimary: "bg-[hsl(262,83%,58%)] text-white hover:opacity-90",
    formFieldInput: "bg-white border border-[hsl(240,5%,82%)] text-[hsl(240,6%,10%)]",
    footerAction: "text-center",
    dividerLine: "bg-[hsl(240,5%,88%)]",
    alert: "bg-[hsl(0,84%,45%)]/10 border border-[hsl(0,84%,45%)]/30",
    otpCodeFieldInput: "bg-white border border-[hsl(240,5%,82%)] text-[hsl(240,6%,10%)]",
    formFieldRow: "",
    main: "",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      {/* path must be the full browser path — Clerk reads window.location.pathname directly */}
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

// Helps the client stay in sync when the signed-in user changes by invalidating the QueryClient cache.
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="space-y-4 text-center">
        <Skeleton className="h-12 w-12 rounded-full mx-auto" />
        <Skeleton className="h-4 w-32 mx-auto" />
      </div>
    </div>
  );
}

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
          <div className="flex-1 overflow-hidden">{children}</div>
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
        <Route path="/dashboard/profile" component={ProfileSettingsPage} />
        <Route path="/dashboard/settings" component={SettingsPage} />
        <Route component={DashboardPage} />
      </Switch>
    </AuthenticatedLayout>
  );
}

function AppRoutes() {
  const { isLoaded, isSignedIn } = useUser();
  const [location, setLocation] = useLocation();

  const { data: dbUser, isLoading: dbUserLoading } = useQuery<DbUser | null>({
    queryKey: ["/api/me"],
    enabled: isLoaded && !!isSignedIn,
  });

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["/api/profile"],
    enabled: isLoaded && !!isSignedIn,
  });

  useEffect(() => {
    if (isSignedIn && (location === "/sign-in" || location === "/sign-up")) {
      setLocation("/dashboard");
    }
  }, [isSignedIn, location, setLocation]);

  const publicPaths = ["/", "/pricing", "/how-it-works", "/industries"];
  const isAuthGatewayRoute = location === "/sign-in" || location === "/sign-up";
  const isPublicRoute = publicPaths.includes(location) || isAuthGatewayRoute;

  if (!isLoaded) {
    return <LoadingScreen />;
  }

  if (!isSignedIn) {
    if (location.startsWith("/dashboard") || location === "/onboarding") {
      return <LandingPage />;
    }
    return (
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/pricing" component={PricingPage} />
        <Route path="/how-it-works" component={HowItWorksPage} />
        <Route path="/industries" component={IndustriesPage} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route component={LandingPage} />
      </Switch>
    );
  }

  if (isPublicRoute) {
    if (isAuthGatewayRoute) {
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

  if (dbUserLoading) {
    return <LoadingScreen />;
  }

  const registrationComplete = !!dbUser?.registrationCompleted;
  const onboardingComplete = (profile as { onboardingStatus?: string })?.onboardingStatus === "completed";

  if (!registrationComplete) {
    return (
      <CompleteRegistrationPage
        existingFirstName={dbUser?.firstName}
        existingLastName={dbUser?.lastName}
      />
    );
  }

  if (profileLoading) {
    return <LoadingScreen />;
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

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to TheSocialPundit",
          },
        },
        signUp: {
          start: {
            title: "Create your account",
            subtitle: "Get started with TheSocialPundit",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <HelmetProvider>
          <ThemeProvider defaultTheme="light" storageKey="socialpundit-theme">
            <TooltipProvider>
              <Toaster />
              <AppRoutes />
            </TooltipProvider>
          </ThemeProvider>
        </HelmetProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
