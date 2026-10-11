import { Link } from "wouter";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { BLOG_POSTS } from "@/lib/blog-posts";
import { USE_CASES } from "@shared/use-cases";

const groups = [
  {
    title: "Product",
    links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/pricing", label: "Pricing" },
      { href: "/use-cases", label: "Use cases" },
      ...USE_CASES.map(useCase => ({ href: `/use-cases/${useCase.slug}`, label: useCase.label })),
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact" },
      { href: "/newsletter", label: "Newsletter" },
    ],
  },
  {
    title: "Policies",
    links: [
      { href: "/privacy", label: "Privacy policy" },
      { href: "/terms", label: "Terms of service" },
      { href: "/refund-policy", label: "Refund policy" },
      { href: "/subscription-cancellation", label: "Subscription cancellation" },
      { href: "/data-retention", label: "Data retention" },
      { href: "/ai-data-processing", label: "AI data processing" },
      { href: "/cookies", label: "Cookie policy" },
    ],
  },
] as const;

export default function SitemapPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEO title="Sitemap" canonical="/sitemap" description="Browse every public product, company, policy, use-case, and journal page on TheSocialPundit." />
      <SiteHeader />
      <main className="flex-1">
        <section className="border-b bg-card py-16 lg:py-20">
          <Reveal className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-secondary-text">Sitemap</p>
            <h1 className="mt-4 heading-display">Find your way around.</h1>
            <p className="mt-4 max-w-2xl text-lg text-muted-foreground">Every public page, organised for people—not just crawlers.</p>
          </Reveal>
        </section>
        <section className="py-16 lg:py-20">
          <StaggerGroup className="mx-auto grid max-w-6xl gap-10 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 lg:px-8">
            {groups.map(group => (
              <StaggerItem key={group.title}>
              <section aria-labelledby={`sitemap-${group.title.toLowerCase()}`}>
                <h2 id={`sitemap-${group.title.toLowerCase()}`} className="font-heading text-2xl font-semibold">{group.title}</h2>
                <ul className="mt-5 space-y-3">
                  {group.links.map(link => <li key={link.href}><Link href={link.href} className="inline-flex min-h-11 items-center text-muted-foreground transition-colors hover:text-primary hover:underline">{link.label}</Link></li>)}
                </ul>
              </section>
              </StaggerItem>
            ))}
          </StaggerGroup>
          <Reveal className="mx-auto mt-16 max-w-6xl border-t px-4 pt-12 sm:px-6 lg:px-8">
          <section aria-labelledby="sitemap-journal">
            <h2 id="sitemap-journal" className="font-heading text-2xl font-semibold">Journal</h2>
            <ul className="mt-6 grid gap-x-10 gap-y-3 md:grid-cols-2">
              <li><Link href="/blog" className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">All journal articles</Link></li>
              {BLOG_POSTS.map(post => <li key={post.slug}><Link href={`/blog/${post.slug}`} className="inline-flex min-h-11 items-center text-muted-foreground transition-colors hover:text-primary hover:underline">{post.title}</Link></li>)}
            </ul>
          </section>
          </Reveal>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
