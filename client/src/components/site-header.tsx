import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { useIsSignedIn } from "@/lib/dev-auth";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, BookOpen, Compass, FileText, Menu, Newspaper, PenLine, Sparkles, X, Zap } from "lucide-react";
import {
  NavigationMenu, NavigationMenuContent, NavigationMenuItem, NavigationMenuLink, NavigationMenuList, NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";

// Product areas open the matching tab of the landing page's product section.
const productLinks = [
  { href: "/#product-pundit", label: "Pundit setup agent", description: "Your news feed built in about a minute", icon: Sparkles },
  { href: "/#product-discover", label: "Discover", description: "Stories picked for your topics, with a reason for each", icon: Compass },
  { href: "/#product-create", label: "Create", description: "Posts in your voice for every network", icon: PenLine },
  { href: "/#product-content", label: "Content", description: "Review, schedule and publish your drafts", icon: FileText },
];
const resourceLinks = [
  { href: "/resources", label: "Guides and templates", description: "Playbooks for turning news into thought leadership", icon: BookOpen, slug: "resources" },
  { href: "/blog", label: "Blog", description: "Ideas on content, AI writing and reputation", icon: Newspaper, slug: "blog" },
];
const plainLinks = [
  { href: "/industries", label: "Industries", slug: "industries" },
  { href: "/pricing", label: "Pricing", slug: "pricing" },
];

function MenuLink({ href, label, description, icon: Icon, testId }: { href: string; label: string; description: string; icon: typeof Compass; testId?: string }) {
  return (
    <NavigationMenuLink asChild>
      <a href={href} className="flex gap-3 rounded-lg p-3 transition-colors hover:bg-accent focus:bg-accent focus:outline-none" data-testid={testId}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"><Icon className="h-4 w-4" aria-hidden="true" /></span>
        <span className="space-y-0.5">
          <span className="block text-sm font-semibold text-foreground">{label}</span>
          <span className="block text-sm text-muted-foreground">{description}</span>
        </span>
      </a>
    </NavigationMenuLink>
  );
}

export function SiteHeader() {
  const isSignedIn = useIsSignedIn();
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const close = () => setMobileMenuOpen(false);
  const linkClass = (href: string) => `text-sm font-medium transition-colors hover:text-primary ${location === href ? "text-foreground" : "text-muted-foreground"}`;

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-1" data-testid="link-logo">
              <Zap className="h-6 w-6 fill-primary text-primary" aria-hidden="true" />
              <span className="text-xl font-bold text-primary">TheSocialPundit</span>
            </Link>

            <NavigationMenu className="hidden lg:flex">
              <NavigationMenuList className="space-x-0 gap-1">
                <NavigationMenuItem>
                  <NavigationMenuTrigger className="bg-transparent text-muted-foreground" data-testid="button-nav-product">Product</NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <div className="grid w-[640px] grid-cols-[1.3fr_1fr] gap-4 p-4">
                      <div className="grid gap-1">
                        {productLinks.map(link => <MenuLink key={link.href} {...link} />)}
                      </div>
                      <NavigationMenuLink asChild>
                        <Link href="/how-it-works" className="flex flex-col justify-end rounded-xl bg-surface-ink p-5 text-surface-ink-foreground" data-testid="link-nav-how-it-works">
                          <Sparkles className="mb-auto h-6 w-6 text-secondary-on-dark" aria-hidden="true" />
                          <span className="mt-10 block font-heading text-lg font-semibold">How it works</span>
                          <span className="mt-1 block text-sm text-surface-ink-foreground/80">From one sentence about your work to your first post, step by step.</span>
                          <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-secondary-on-dark">See the walkthrough<ArrowRight className="h-4 w-4" aria-hidden="true" /></span>
                        </Link>
                      </NavigationMenuLink>
                    </div>
                  </NavigationMenuContent>
                </NavigationMenuItem>
                <NavigationMenuItem>
                  <NavigationMenuTrigger className="bg-transparent text-muted-foreground" data-testid="button-nav-resources">Resources</NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <div className="grid w-[380px] gap-1 p-3">
                      {resourceLinks.map(link => <MenuLink key={link.href} {...link} testId={`link-nav-${link.slug}`} />)}
                    </div>
                  </NavigationMenuContent>
                </NavigationMenuItem>
                {plainLinks.map(link => (
                  <NavigationMenuItem key={link.href}>
                    <Link href={link.href} className={`inline-flex h-10 items-center px-4 ${linkClass(link.href)}`} data-testid={`link-nav-${link.slug}`}>{link.label}</Link>
                  </NavigationMenuItem>
                ))}
              </NavigationMenuList>
            </NavigationMenu>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden lg:block">
              {isSignedIn ? (
                <Link href="/dashboard" data-testid="link-header-dashboard">
                  <Button data-testid="button-header-dashboard">Dashboard</Button>
                </Link>
              ) : (
                <div className="flex items-center gap-2">
                  <Link href="/sign-in" data-testid="link-header-login">
                    <Button variant="ghost" data-testid="button-header-login">Sign In</Button>
                  </Link>
                  <Link href="/sign-up" data-testid="link-header-register">
                    <Button data-testid="button-header-register">Start free</Button>
                  </Link>
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-expanded={mobileMenuOpen}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              data-testid="button-mobile-menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden lg:hidden"
              data-testid="mobile-menu"
            >
              <div className="max-h-[calc(100dvh-4rem)] space-y-5 overflow-y-auto border-t py-4">
                <nav aria-label="Product" className="space-y-1">
                  <p className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Product</p>
                  {productLinks.map(link => (
                    <a key={link.href} href={link.href} onClick={close} className="flex min-h-11 items-center gap-3 rounded-md px-1 text-sm font-medium text-foreground hover:text-primary">
                      <link.icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{link.label}
                    </a>
                  ))}
                  <Link href="/how-it-works" onClick={close} className="flex min-h-11 items-center gap-3 rounded-md px-1 text-sm font-medium text-foreground hover:text-primary" data-testid="link-mobile-nav-how-it-works">
                    <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />How it works
                  </Link>
                </nav>
                <nav aria-label="More" className="flex flex-col">
                  {[...plainLinks, ...resourceLinks.map(link => ({ href: link.href, label: link.label === "Guides and templates" ? "Resources" : link.label, slug: link.slug }))].map(link => (
                    <Link key={link.href} href={link.href} onClick={close} className={`flex min-h-11 items-center px-1 ${linkClass(link.href)}`} data-testid={`link-mobile-nav-${link.slug}`}>
                      {link.label}
                    </Link>
                  ))}
                </nav>
                <div className="border-t pt-4">
                  {isSignedIn ? (
                    <Link href="/dashboard" onClick={close} data-testid="link-mobile-dashboard">
                      <Button className="w-full" data-testid="button-mobile-dashboard">Dashboard</Button>
                    </Link>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <Button asChild variant="outline" className="w-full" data-testid="button-mobile-login">
                        <Link href="/sign-in" onClick={close}>Sign In</Link>
                      </Button>
                      <Button asChild className="w-full" data-testid="button-mobile-register">
                        <Link href="/sign-up" onClick={close}>Start free</Link>
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
