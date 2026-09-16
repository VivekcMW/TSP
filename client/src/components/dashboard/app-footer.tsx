import { Link } from "wouter";

// Slim app-chrome footer for the authenticated dashboard shell — distinct
// from the full marketing SiteFooter, which would be too heavy for a
// data-dense app layout. Pinned below the scrollable page content.
export function AppFooter() {
  return (
    <footer className="shrink-0 border-t bg-background px-4 py-2 flex flex-col sm:flex-row items-center justify-between gap-1 text-xs text-muted-foreground">
      <p data-testid="text-app-footer-copyright">
        &copy; {new Date().getFullYear()} TheSocialPundit. All rights reserved.
      </p>
      <nav className="flex items-center gap-4">
        <Link href="/privacy" className="hover:text-foreground transition-colors" data-testid="link-app-footer-privacy">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-foreground transition-colors" data-testid="link-app-footer-terms">
          Terms
        </Link>
        <Link href="/refund-policy" className="hover:text-foreground transition-colors">Refunds</Link>
        <Link href="/cookies" className="hover:text-foreground transition-colors">Cookies</Link>
        <Link href="/data-retention" className="hover:text-foreground transition-colors">Retention</Link>
        <Link href="/ai-data-processing" className="hover:text-foreground transition-colors">AI Data</Link>
        <Link href="/contact" className="hover:text-foreground transition-colors" data-testid="link-app-footer-contact">
          Contact
        </Link>
      </nav>
    </footer>
  );
}
