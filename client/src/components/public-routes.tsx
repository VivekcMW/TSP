import { lazy, Suspense, type ReactNode } from "react";
import { Route, Switch } from "wouter";

import LandingPage from "@/pages/landing";
import NotFound from "@/pages/not-found";
import { ResetPasswordPage } from "@/pages/auth";
import { LoadingScreen } from "@/components/loading-screen";

const PricingPage = lazy(() => import("@/pages/pricing"));
const HowItWorksPage = lazy(() => import("@/pages/how-it-works"));
const IndustriesPage = lazy(() => import("@/pages/industries"));
const BlogPage = lazy(() => import("@/pages/blog"));
const BlogPostPage = lazy(() => import("@/pages/blog-post"));
const ResourcesPage = lazy(() => import("@/pages/resources"));
const AboutPage = lazy(() => import("@/pages/about"));
const ContactPage = lazy(() => import("@/pages/contact"));
const PrivacyPolicyPage = lazy(() => import("@/pages/privacy"));
const TermsOfServicePage = lazy(() => import("@/pages/terms"));
const RefundPolicyPage = lazy(() => import("@/pages/refund-policy"));
const SubscriptionCancellationPage = lazy(() => import("@/pages/subscription-cancellation"));
const DataRetentionPage = lazy(() => import("@/pages/data-retention"));
const AIDataProcessingPage = lazy(() => import("@/pages/ai-data-processing"));
const CookiePolicyPage = lazy(() => import("@/pages/cookies"));
const EmailPreferencesPage = lazy(() => import("@/pages/email-preferences"));
const InvitationPreferencesPage = lazy(() => import("@/pages/invitation-preferences"));
const NewsletterPage = lazy(() => import("@/pages/newsletter"));
const CaseStudiesPage = lazy(() => import("@/pages/case-studies"));
const CareersPage = lazy(() => import("@/pages/careers"));

/**
 * The marketing site. Reachable signed in or signed out, so this list lived in
 * App.tsx twice — once per branch — and had to be kept in sync by hand.
 *
 * The path list here must stay in agreement with PUBLIC_PATHS in lib/gate.ts:
 * the gate decides *whether* to render this tree, this component decides which
 * page within it.
 */
export function PublicRoutes({ signInRoutes, location }: { signInRoutes?: ReactNode; location?: string }) {
  return (
    <Suspense fallback={<LoadingScreen />}>
    <Switch location={location}>
      <Route path="/" component={LandingPage} />
      <Route path="/pricing" component={PricingPage} />
      <Route path="/how-it-works" component={HowItWorksPage} />
      <Route path="/industries" component={IndustriesPage} />
      <Route path="/blog" component={BlogPage} />
      <Route path="/blog/:slug" component={BlogPostPage} />
      <Route path="/resources" component={ResourcesPage} />
      <Route path="/about" component={AboutPage} />
      <Route path="/contact" component={ContactPage} />
      <Route path="/privacy" component={PrivacyPolicyPage} />
      <Route path="/terms" component={TermsOfServicePage} />
      <Route path="/refund-policy" component={RefundPolicyPage} />
      <Route path="/subscription-cancellation" component={SubscriptionCancellationPage} />
      <Route path="/data-retention" component={DataRetentionPage} />
      <Route path="/ai-data-processing" component={AIDataProcessingPage} />
      <Route path="/cookies" component={CookiePolicyPage} />
      <Route path="/email-preferences" component={EmailPreferencesPage} />
      <Route path="/invitation-preferences" component={InvitationPreferencesPage} />
      <Route path="/newsletter" component={NewsletterPage} />
      <Route path="/case-studies" component={CaseStudiesPage} />
      <Route path="/careers" component={CareersPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      {signInRoutes}
      <Route component={NotFound} />
    </Switch>
    </Suspense>
  );
}
