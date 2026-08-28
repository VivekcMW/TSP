import { Route, Switch } from "wouter";

import LandingPage from "@/pages/landing";
import PricingPage from "@/pages/pricing";
import HowItWorksPage from "@/pages/how-it-works";
import IndustriesPage from "@/pages/industries";
import BlogPage from "@/pages/blog";
import BlogPostPage from "@/pages/blog-post";
import ResourcesPage from "@/pages/resources";
import AboutPage from "@/pages/about";
import ContactPage from "@/pages/contact";
import PrivacyPolicyPage from "@/pages/privacy";
import TermsOfServicePage from "@/pages/terms";
import CaseStudiesPage from "@/pages/case-studies";
import CareersPage from "@/pages/careers";
import NotFound from "@/pages/not-found";

/**
 * The marketing site. Reachable signed in or signed out, so this list lived in
 * App.tsx twice — once per branch — and had to be kept in sync by hand.
 *
 * The path list here must stay in agreement with PUBLIC_PATHS in lib/gate.ts:
 * the gate decides *whether* to render this tree, this component decides which
 * page within it.
 */
export function PublicRoutes({ signInRoutes }: { signInRoutes?: React.ReactNode }) {
  return (
    <Switch>
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
      <Route path="/case-studies" component={CaseStudiesPage} />
      <Route path="/careers" component={CareersPage} />
      {signInRoutes}
      <Route component={NotFound} />
    </Switch>
  );
}
