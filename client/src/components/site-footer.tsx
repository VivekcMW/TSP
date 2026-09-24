import { Link } from "wouter";
import { Zap } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import { fadeIn } from "@/lib/motion";
import { openCookieSettings } from "@/lib/analytics-consent";

export function SiteFooter() {
  return (
    <footer className="relative bg-surface-ink text-surface-ink-foreground/70">
      <div className="h-[2px] bg-gradient-to-r from-transparent via-secondary to-transparent" />
      <Reveal variants={fadeIn} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-1" data-testid="link-footer-logo">
              <Zap className="w-6 h-6 text-secondary fill-secondary" />
              <span className="text-lg font-bold text-surface-ink-foreground">TheSocialPundit</span>
            </Link>
            <p className="mt-4 font-serif italic text-surface-ink-foreground/80 text-base">
              Turn industry news into thought leadership.
            </p>
            <p className="mt-2 text-sm text-surface-ink-foreground/50 max-w-xs">
              Build your professional authority across 23 platforms, in minutes, not hours.
            </p>
          </div>
          
          <div>
            <h4 className="text-secondary text-xs font-bold uppercase tracking-wider mb-4">Product</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/how-it-works" className="hover:text-surface-ink-foreground transition-colors" data-testid="link-footer-how-it-works">
                  How It Works
                </Link>
              </li>
              <li>
                <Link href="/industries" className="hover:text-surface-ink-foreground transition-colors" data-testid="link-footer-industries">
                  Industries
                </Link>
              </li>
              <li>
                <Link href="/resources" className="hover:text-surface-ink-foreground transition-colors" data-testid="link-footer-resources">
                  Resources
                </Link>
              </li>
              <li>
                <Link href="/blog" className="hover:text-surface-ink-foreground transition-colors" data-testid="link-footer-blog">
                  Blog
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="hover:text-surface-ink-foreground transition-colors" data-testid="link-footer-pricing">
                  Pricing
                </Link>
              </li>
            </ul>
          </div>
          
          <div>
            <h4 className="text-secondary text-xs font-bold uppercase tracking-wider mb-4">Company</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/about" className="hover:text-surface-ink-foreground transition-colors" data-testid="link-footer-about">
                  About
                </Link>
              </li>
              <li>
                <Link href="/contact" className="hover:text-surface-ink-foreground transition-colors" data-testid="link-footer-contact">
                  Contact
                </Link>
              </li>
              <li>
                <Link href="/case-studies" className="hover:text-surface-ink-foreground transition-colors" data-testid="link-footer-case-studies">
                  Case Studies
                </Link>
              </li>
              <li>
                <Link href="/careers" className="hover:text-surface-ink-foreground transition-colors" data-testid="link-footer-careers">
                  Careers
                </Link>
              </li>
            </ul>
          </div>
          
          <div>
            <h4 className="text-secondary text-xs font-bold uppercase tracking-wider mb-4">Legal</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/privacy" className="hover:text-surface-ink-foreground transition-colors" data-testid="link-footer-privacy">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-surface-ink-foreground transition-colors" data-testid="link-footer-terms">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/refund-policy" className="hover:text-surface-ink-foreground transition-colors">Refund Policy</Link>
              </li>
              <li>
                <Link href="/subscription-cancellation" className="hover:text-surface-ink-foreground transition-colors">Cancellation</Link>
              </li>
              <li>
                <Link href="/cookies" className="hover:text-surface-ink-foreground transition-colors">Cookie Policy</Link>
              </li>
              <li>
                <button type="button" onClick={openCookieSettings} className="text-left hover:text-surface-ink-foreground transition-colors" data-testid="button-footer-cookie-settings">Cookie settings</button>
              </li>
              <li>
                <Link href="/data-retention" className="hover:text-surface-ink-foreground transition-colors">Data Retention</Link>
              </li>
              <li>
                <Link href="/ai-data-processing" className="hover:text-surface-ink-foreground transition-colors">AI Data Processing</Link>
              </li>
            </ul>
          </div>
        </div>
        
        <div className="mt-12 pt-8 border-t border-surface-ink-foreground/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-surface-ink-foreground/60">
          <p data-testid="text-copyright">&copy; 2026 TheSocialPundit. All rights reserved.</p>
          <p>Built for professionals, worldwide.</p>
        </div>
      </Reveal>
    </footer>
  );
}
