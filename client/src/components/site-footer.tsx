import { Link } from "wouter";

export function SiteFooter() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="text-lg font-bold" data-testid="link-footer-logo">
              TheSocialPundit
            </Link>
            <p className="mt-4 text-sm text-muted-foreground">
              Turn industry news into thought leadership. Build your professional authority in minutes.
            </p>
          </div>
          
          <div>
            <h4 className="font-semibold mb-4">Product</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="/#how-it-works" className="hover:text-foreground transition-colors" data-testid="link-footer-how-it-works">
                  How It Works
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="hover:text-foreground transition-colors" data-testid="link-footer-pricing">
                  Pricing
                </Link>
              </li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-semibold mb-4">Company</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a href="mailto:hello@thesocialpundit.com" className="hover:text-foreground transition-colors" data-testid="link-footer-contact">
                  Contact
                </a>
              </li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-semibold mb-4">Legal</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a href="#" className="hover:text-foreground transition-colors" data-testid="link-footer-privacy">
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-foreground transition-colors" data-testid="link-footer-terms">
                  Terms of Service
                </a>
              </li>
            </ul>
          </div>
        </div>
        
        <div className="mt-12 pt-8 border-t text-center text-sm text-muted-foreground">
          <p data-testid="text-copyright">2025 TheSocialPundit. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
