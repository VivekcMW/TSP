import { Link } from "wouter";
import { Zap } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import { fadeIn } from "@/lib/motion";
import { openCookieSettings } from "@/lib/analytics-consent";
import { SOCIAL_NETWORKS } from "@/lib/platforms";

export function SiteFooter() {
  return (
    <footer className="relative border-t border-border bg-card text-muted-foreground [&_a]:underline-offset-4 [&_a:hover]:underline [&_:focus-visible]:outline [&_:focus-visible]:outline-2 [&_:focus-visible]:outline-ring [&_:focus-visible]:outline-offset-2">
      <Reveal variants={fadeIn} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-1" data-testid="link-footer-logo">
              <Zap className="w-6 h-6 text-primary fill-primary" />
              <span className="text-lg font-bold text-foreground">TheSocialPundit</span>
            </Link>
            <p className="mt-4 font-serif italic text-foreground text-base">
              Turn industry news into thought leadership.
            </p>
            <p className="mt-2 text-sm text-muted-foreground max-w-xs">
              Build your professional authority across {SOCIAL_NETWORKS.length} networks, in minutes, not hours.
            </p>
          </div>
          
          <div>
            <h4 className="text-info text-xs font-bold uppercase tracking-wider mb-4">Product</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/how-it-works" className="hover:text-primary transition-colors" data-testid="link-footer-how-it-works">
                  How It Works
                </Link>
              </li>
              <li>
                <Link href="/industries" className="hover:text-primary transition-colors" data-testid="link-footer-industries">
                  Industries
                </Link>
              </li>
              <li>
                <Link href="/resources" className="hover:text-primary transition-colors" data-testid="link-footer-resources">
                  Resources
                </Link>
              </li>
              <li>
                <Link href="/blog" className="hover:text-primary transition-colors" data-testid="link-footer-blog">
                  Blog
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="hover:text-primary transition-colors" data-testid="link-footer-pricing">
                  Pricing
                </Link>
              </li>
            </ul>
          </div>
          
          <div>
            <h4 className="text-info text-xs font-bold uppercase tracking-wider mb-4">Company</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/about" className="hover:text-primary transition-colors" data-testid="link-footer-about">
                  About
                </Link>
              </li>
              <li>
                <Link href="/contact" className="hover:text-primary transition-colors" data-testid="link-footer-contact">
                  Contact
                </Link>
              </li>
            </ul>
          </div>
          
          <div>
            <h4 className="text-info text-xs font-bold uppercase tracking-wider mb-4">Legal</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/privacy" className="hover:text-primary transition-colors" data-testid="link-footer-privacy">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-primary transition-colors" data-testid="link-footer-terms">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/refund-policy" className="hover:text-primary transition-colors">Refund Policy</Link>
              </li>
              <li>
                <Link href="/subscription-cancellation" className="hover:text-primary transition-colors">Cancellation</Link>
              </li>
              <li>
                <Link href="/cookies" className="hover:text-primary transition-colors">Cookie Policy</Link>
              </li>
              <li>
                <button type="button" onClick={openCookieSettings} className="text-left hover:text-primary hover:underline transition-colors" data-testid="button-footer-cookie-settings">Cookie settings</button>
              </li>
              <li>
                <Link href="/data-retention" className="hover:text-primary transition-colors">Data Retention</Link>
              </li>
              <li>
                <Link href="/ai-data-processing" className="hover:text-primary transition-colors">AI Data Processing</Link>
              </li>
            </ul>
          </div>
        </div>
        
        <div className="mt-12 pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <p data-testid="text-copyright">&copy; 2026 TheSocialPundit. All rights reserved.</p>
          <p>Built for professionals, worldwide.</p>
        </div>
      </Reveal>
    </footer>
  );
}
