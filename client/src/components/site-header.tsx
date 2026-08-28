import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { useIsSignedIn } from "@/lib/dev-auth";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X, Zap } from "lucide-react";

export function SiteHeader() {
  const isSignedIn = useIsSignedIn();
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { href: "/", label: "Home", slug: "home" },
    { href: "/industries", label: "Industries", slug: "industries" },
    { href: "/how-it-works", label: "How it Works", slug: "how-it-works" },
    { href: "/resources", label: "Resources", slug: "resources" },
    { href: "/blog", label: "Blog", slug: "blog" },
    { href: "/pricing", label: "Pricing", slug: "pricing" },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-1" data-testid="link-logo">
              <Zap className="w-6 h-6 text-primary fill-primary" />
              <span className="text-xl font-bold text-primary">TheSocialPundit</span>
            </Link>
            
            <nav className="hidden lg:flex items-center gap-6">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`text-sm font-medium transition-colors hover:text-primary ${
                    location === item.href ? "text-foreground" : "text-muted-foreground"
                  }`}
                  data-testid={`link-nav-${item.slug}`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
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
                    <Button data-testid="button-header-register">Start Free</Button>
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
              className="lg:hidden overflow-hidden"
            >
              <div className="border-t py-4 space-y-4">
                <nav className="flex flex-col gap-3">
                  {navItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`text-sm font-medium py-2 transition-colors hover:text-primary ${
                        location === item.href ? "text-foreground" : "text-muted-foreground"
                      }`}
                      data-testid={`link-mobile-nav-${item.slug}`}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
                <div className="pt-2 border-t">
                  {isSignedIn ? (
                    <Link href="/dashboard" onClick={() => setMobileMenuOpen(false)} data-testid="link-mobile-dashboard">
                      <Button className="w-full" data-testid="button-mobile-dashboard">Dashboard</Button>
                    </Link>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <Link href="/sign-in" onClick={() => setMobileMenuOpen(false)} data-testid="link-mobile-login">
                        <Button variant="outline" className="w-full" data-testid="button-mobile-login">Sign In</Button>
                      </Link>
                      <Link href="/sign-up" onClick={() => setMobileMenuOpen(false)} data-testid="link-mobile-register">
                        <Button className="w-full" data-testid="button-mobile-register">Start Free</Button>
                      </Link>
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
