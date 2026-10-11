import { useMemo, useState } from "react";
import { Link } from "wouter";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { Badge } from "@/components/ui/badge";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { fadeUp } from "@/lib/motion";
import { BLOG_POSTS } from "@/lib/blog-posts";
import { ArrowRight, ArrowUpRight, CalendarDays, Clock3 } from "lucide-react";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function StoryMeta({ post, light = false }: { post: (typeof BLOG_POSTS)[number]; light?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 text-xs ${light ? "text-white/60" : "text-muted-foreground"}`}>
      <span>{post.author}</span>
      <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />{formatDate(post.date)}</span>
      <span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{post.readTime}</span>
    </div>
  );
}

export default function BlogPage() {
  const [activeCategory, setActiveCategory] = useState("All stories");
  const categories = useMemo(() => ["All stories", ...new Set(BLOG_POSTS.map(post => post.category))], []);
  const featured = BLOG_POSTS[0];
  const archive = BLOG_POSTS.slice(1).filter(post => activeCategory === "All stories" || post.category === activeCategory);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEO
        title="TheSocialPundit Journal"
        canonical="/blog"
        description="TheSocialPundit Journal: clear thinking on professional authority, content strategy, AI-assisted writing, and showing up with a point of view."
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "TheSocialPundit Journal",
          url: "https://www.thesocialpundit.com/blog",
          description: "Clear thinking on professional authority, content strategy, AI-assisted writing, and showing up with a point of view.",
          mainEntity: {
            "@type": "ItemList",
            itemListElement: BLOG_POSTS.map((post, index) => ({
              "@type": "ListItem",
              position: index + 1,
              url: `https://www.thesocialpundit.com/blog/${post.slug}`,
              name: post.title,
            })),
          },
        }}
      />
      <SiteHeader />
      <main className="flex-1">
        <section className="border-b bg-card" data-testid="section-blog-hero">
          <div className="mx-auto max-w-7xl px-4 pb-16 pt-14 sm:px-6 lg:pb-20 lg:pt-20">
            <div className="flex flex-col items-center gap-8 text-center">
              <div className="max-w-3xl">
                <h1 className="font-heading text-5xl font-semibold leading-[0.98] tracking-tight text-foreground sm:text-6xl lg:text-7xl" data-testid="text-blog-title">
                  Ideas for people<br className="hidden sm:block" /> with something to say.
                </h1>
                <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
                  Clear thinking on professional authority, useful AI, and the craft of showing up with a point of view people remember.
                </p>
              </div>
              <p className="max-w-md border-t-2 border-primary px-4 pt-4 text-sm leading-6 text-muted-foreground">
                New perspectives for the people building a reputation in public.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:py-16" data-testid="section-blog-grid">
          <Link href={`/blog/${featured.slug}`} className="group block" data-testid={`link-blog-post-${featured.slug}`}>
            <article className="relative overflow-hidden rounded-[2rem] bg-foreground text-background">
              <div className="absolute -right-28 -top-40 h-96 w-96 rounded-full bg-primary/35 blur-3xl transition-transform duration-700 group-hover:scale-110" aria-hidden="true" />
              <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:40px_40px]" aria-hidden="true" />
              <div className="relative grid min-h-[27rem] items-end gap-10 p-7 sm:p-10 lg:grid-cols-[1fr_0.8fr] lg:p-14">
                <div className="max-w-2xl">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge className="border-0 bg-white/10 text-white">{featured.category}</Badge>
                    <span className="text-xs font-bold uppercase tracking-[0.18em] text-white/50">Featured story</span>
                  </div>
                  <h2 className="mt-6 font-heading text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
                    {featured.title}
                  </h2>
                  <p className="mt-5 max-w-xl text-base leading-7 text-white/70 sm:text-lg">{featured.excerpt}</p>
                  <div className="mt-8 flex flex-wrap items-center gap-5">
                    <span className="inline-flex items-center gap-2 font-semibold text-white">Read the story <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" /></span>
                    <StoryMeta post={featured} light />
                  </div>
                </div>
                <div className="hidden justify-self-end lg:block" aria-hidden="true">
                  <div className="relative h-64 w-64 rotate-6 rounded-[2rem] border border-white/15 bg-white/10 p-5 shadow-2xl backdrop-blur-sm transition-transform duration-700 group-hover:rotate-3">
                    <div className="flex items-center justify-between text-xs font-bold uppercase tracking-[0.18em] text-white/45"><span>Journal</span><span>01</span></div>
                    <div className="mt-12 space-y-3">
                      <div className="h-2 w-4/5 rounded-full bg-white/30" />
                      <div className="h-2 w-full rounded-full bg-white/15" />
                      <div className="h-2 w-3/5 rounded-full bg-primary" />
                    </div>
                    <div className="absolute bottom-5 left-5 right-5 flex items-center justify-between border-t border-white/15 pt-4 text-xs text-white/50"><span>One idea</span><span>One voice</span></div>
                  </div>
                </div>
              </div>
            </article>
          </Link>
        </section>

        <section className="border-y bg-muted/25" aria-label="Blog categories">
          <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 py-3 sm:px-6">
            {categories.map(category => (
              <button
                key={category}
                type="button"
                onClick={() => setActiveCategory(category)}
                aria-pressed={activeCategory === category}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${activeCategory === category ? "bg-foreground text-background" : "text-muted-foreground hover:bg-card hover:text-foreground"}`}
              >
                {category}
              </button>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:py-20">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">The archive</p>
              <h2 className="mt-2 font-heading text-3xl font-semibold tracking-tight text-foreground">More to read</h2>
            </div>
            <span className="text-sm text-muted-foreground">{archive.length} {archive.length === 1 ? "story" : "stories"}</span>
          </div>
          <StaggerGroup className="grid gap-x-6 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
            {archive.map((post, index) => (
              <StaggerItem key={post.slug}>
                <Link href={`/blog/${post.slug}`} className="group block h-full" data-testid={`link-blog-post-${post.slug}`}>
                  <article className="flex h-full flex-col border-t-2 border-border pt-5 transition-colors group-hover:border-primary">
                    <div className="flex items-center justify-between gap-3">
                      <Badge variant="secondary" className="border-0 text-xs">{post.category}</Badge>
                      <span className="font-heading text-3xl font-semibold text-border transition-colors group-hover:text-primary/30">{String(index + 2).padStart(2, "0")}</span>
                    </div>
                    <h3 className="mt-5 font-heading text-2xl font-semibold leading-tight tracking-tight text-foreground">{post.title}</h3>
                    <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">{post.excerpt}</p>
                    <div className="mt-6 flex items-center justify-between border-t pt-4">
                      <StoryMeta post={post} />
                      <ArrowRight className="h-4 w-4 text-primary transition-transform group-hover:translate-x-1" aria-hidden="true" />
                    </div>
                  </article>
                </Link>
              </StaggerItem>
            ))}
          </StaggerGroup>
          {archive.length === 0 && <p className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">No stories in this category yet.</p>}
        </section>

        <Reveal variants={fadeUp}>
          <section className="border-t bg-card" data-testid="section-blog-cta">
            <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-4 py-14 sm:px-6 md:flex-row md:items-center lg:py-20">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Take the next step</p>
                <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight">Your next strong opinion is already in there.</h2>
                <p className="mt-2 text-muted-foreground">Turn the ideas you notice into a professional presence that compounds.</p>
              </div>
              <Link href="/sign-up" className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-transform hover:translate-y-[-2px]" data-testid="link-blog-cta-signup">
                Start building <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </section>
        </Reveal>
      </main>
      <SiteFooter />
    </div>
  );
}
