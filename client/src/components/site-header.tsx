import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Menu, X, Zap } from "lucide-react";

export function SiteHeader() {
  const { user } = useAuth();
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { href: "/", label: "Home", slug: "home" },
    { href: "/industries", label: "Industries", slug: "industries" },
    { href: "/how-it-works", label: "How it Works", slug: "how-it-works" },
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
            
            <nav className="hidden md:flex items-center gap-6">
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
            <ThemeToggle />
            <div className="hidden md:block">
              {user ? (
                <Link href="/dashboard" data-testid="link-header-dashboard">
                  <Button data-testid="button-header-dashboard">Dashboard</Button>
                </Link>
              ) : (
                <div className="flex items-center gap-2">
                  <Link href="/login" data-testid="link-header-login">
                    <Button variant="ghost" data-testid="button-header-login">Sign In</Button>
                  </Link>
                  <Link href="/register" data-testid="link-header-register">
                    <Button data-testid="button-header-register">Start Free</Button>
                  </Link>
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-expanded={mobileMenuOpen}
              data-testid="button-mobile-menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>
        
        {mobileMenuOpen && (
          <div className="md:hidden border-t py-4 space-y-4">
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
              {user ? (
                <Link href="/dashboard" onClick={() => setMobileMenuOpen(false)} data-testid="link-mobile-dashboard">
                  <Button className="w-full" data-testid="button-mobile-dashboard">Dashboard</Button>
                </Link>
              ) : (
                <div className="flex flex-col gap-2">
                  <Link href="/login" onClick={() => setMobileMenuOpen(false)} data-testid="link-mobile-login">
                    <Button variant="outline" className="w-full" data-testid="button-mobile-login">Sign In</Button>
                  </Link>
                  <Link href="/register" onClick={() => setMobileMenuOpen(false)} data-testid="link-mobile-register">
                    <Button className="w-full" data-testid="button-mobile-register">Start Free</Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
