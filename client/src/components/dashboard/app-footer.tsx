import { Link } from "wouter";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openCookieSettings } from "@/lib/analytics-consent";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const legalLinks = [
  { href: "/privacy", label: "Privacy", testId: "link-app-footer-privacy" },
  { href: "/terms", label: "Terms", testId: "link-app-footer-terms" },
  { href: "/refund-policy", label: "Refunds" },
  { href: "/cookies", label: "Cookies" },
  { href: "/data-retention", label: "Retention" },
  { href: "/ai-data-processing", label: "AI Data" },
];

// Slim app-chrome footer for the authenticated dashboard shell — distinct
// from the full marketing SiteFooter, which would be too heavy for a
// data-dense app layout. Pinned below the scrollable page content.
export function AppFooter() {
  return (
    <footer className="dashboard-gutter shrink-0 border-t bg-background py-1 text-xs text-muted-foreground">
      <div className="dashboard-container flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <p className="min-w-0" data-testid="text-app-footer-copyright">
        &copy; {new Date().getFullYear()} TheSocialPundit. All rights reserved.
      </p>
      <nav aria-label="Legal and support" className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="min-h-11 min-w-11 px-2 text-xs" data-testid="button-app-footer-legal">
              Legal <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="max-w-[calc(100vw-2rem)]">
            {legalLinks.map(({ href, label, testId }) => (
              <DropdownMenuItem key={href} asChild className="min-h-11">
                <Link href={href} data-testid={testId}>{label}</Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem className="min-h-11" onSelect={openCookieSettings} data-testid="button-app-footer-cookie-settings">Cookie settings</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Link href="/contact" className="inline-flex min-h-11 min-w-11 items-center rounded-md px-2 hover:text-foreground transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2" data-testid="link-app-footer-contact">
          Contact
        </Link>
      </nav>
      </div>
    </footer>
  );
}
