import { Link } from "wouter";
import { Zap } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import { fadeIn } from "@/lib/motion";

export function SiteFooter() {
  return (
    <footer className="relative bg-surface-ink text-white/70">
      <div className="h-[2px] bg-gradient-to-r from-transparent via-secondary to-transparent" />
      <Reveal variants={fadeIn} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-1" data-testid="link-footer-logo">
              <Zap className="w-6 h-6 text-secondary fill-secondary" />
              <span className="text-lg font-bold text-white">TheSocialPundit</span>
            </Link>
            <p className="mt-4 font-serif italic text-white/80 text-base">
              Turn industry news into thought leadership.
            </p>
            <p className="mt-2 text-sm text-white/50 max-w-xs">
              Build your professional authority across 23 platforms, in minutes, not hours.
            </p>
          </div>
          
          <div>
            <h4 className="text-secondary text-xs font-bold uppercase tracking-wider mb-4">Product</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/how-it-works" className="hover:text-white transition-colors" data-testid="link-footer-how-it-works">
                  How It Works
                </Link>
              </li>
              <li>
                <Link href="/industries" className="hover:text-white transition-colors" data-testid="link-footer-industries">
                  Industries
                </Link>
              </li>
              <li>
                <Link href="/resources" className="hover:text-white transition-colors" data-testid="link-footer-resources">
                  Resources
                </Link>
              </li>
              <li>
                <Link href="/blog" className="hover:text-white transition-colors" data-testid="link-footer-blog">
                  Blog
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="hover:text-white transition-colors" data-testid="link-footer-pricing">
                  Pricing
                </Link>
              </li>
            </ul>
          </div>
          
          <div>
            <h4 className="text-secondary text-xs font-bold uppercase tracking-wider mb-4">Company</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/about" className="hover:text-white transition-colors" data-testid="link-footer-about">
                  About
                </Link>
              </li>
              <li>
                <Link href="/contact" className="hover:text-white transition-colors" data-testid="link-footer-contact">
                  Contact
                </Link>
              </li>
              <li>
                <Link href="/case-studies" className="hover:text-white transition-colors" data-testid="link-footer-case-studies">
                  Case Studies
                </Link>
              </li>
              <li>
                <Link href="/careers" className="hover:text-white transition-colors" data-testid="link-footer-careers">
                  Careers
                </Link>
              </li>
            </ul>
          </div>
          
          <div>
            <h4 className="text-secondary text-xs font-bold uppercase tracking-wider mb-4">Legal</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/privacy" className="hover:text-white transition-colors" data-testid="link-footer-privacy">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-white transition-colors" data-testid="link-footer-terms">
                  Terms of Service
                </Link>
              </li>
            </ul>
          </div>
        </div>
        
        <div className="mt-12 pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/40">
          <p data-testid="text-copyright">&copy; 2026 TheSocialPundit. All rights reserved.</p>
          <p>Built for professionals, worldwide.</p>
        </div>
      </Reveal>
    </footer>
  );
}
