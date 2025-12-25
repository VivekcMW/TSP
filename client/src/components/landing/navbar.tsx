import { useState } from "react";
import { Zap, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
  { label: "Blog", href: "#" },
];

export function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <nav className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
        <a href="/" className="flex items-center gap-1" data-testid="link-logo">
          <Zap className="w-6 h-6 text-primary fill-primary" />
          <span className="font-bold text-xl text-primary hidden sm:block">TheSocialPundit</span>
        </a>
        
        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <a 
              key={link.label}
              href={link.href}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              data-testid={`link-nav-${link.label.toLowerCase()}`}
            >
              {link.label}
            </a>
          ))}
        </div>
        
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <a href="/api/login" className="hidden sm:block">
            <Button variant="ghost" data-testid="button-login">
              Log in
            </Button>
          </a>
          <a href="/api/login" className="hidden sm:block">
            <Button data-testid="button-get-started">
              Get Started
            </Button>
          </a>
          
          <Button 
            variant="ghost" 
            size="icon" 
            className="md:hidden"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            data-testid="button-mobile-menu"
          >
            {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </nav>
      
      {isMenuOpen && (
        <div className="md:hidden border-t bg-background px-6 py-4 space-y-4">
          {navLinks.map((link) => (
            <a 
              key={link.label}
              href={link.href}
              className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setIsMenuOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <div className="pt-4 border-t space-y-2">
            <a href="/api/login" className="block">
              <Button variant="outline" className="w-full">Log in</Button>
            </a>
            <a href="/api/login" className="block">
              <Button className="w-full">Get Started</Button>
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
