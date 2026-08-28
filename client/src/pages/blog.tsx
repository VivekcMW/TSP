import { Link } from "wouter";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { fadeUp } from "@/lib/motion";
import { BLOG_POSTS } from "@/lib/blog-posts";
import { CalendarDays, Clock, Sparkles } from "lucide-react";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function BlogPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO
        title="Blog"
        canonical="/blog"
        description="Ideas, strategy, and lessons on building professional authority across 23 platforms — from LinkedIn to Mastodon, Reddit, Weibo, and developer blogs."
      />
      <SiteHeader />
      <main className="flex-1">
        <section className="py-16 lg:py-24" data-testid="section-blog-hero">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <Badge className="mb-6 bg-primary/10 text-primary border-0">
              <Sparkles className="w-3 h-3 mr-1" />
              Ideas &amp; Strategy
            </Badge>
            <h1 className="heading-display mb-6" data-testid="text-blog-title">
              The Blog
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Practical thinking on content strategy, AI-assisted writing, and building a professional
              reputation that compounds — across every platform your industry pays attention to.
            </p>
          </div>
        </section>

        <section className="pb-20 lg:pb-28" data-testid="section-blog-grid">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <StaggerGroup className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {BLOG_POSTS.map((post) => (
                <StaggerItem key={post.slug}>
                  <Link href={`/blog/${post.slug}`} data-testid={`link-blog-post-${post.slug}`}>
                    <Card className="h-full border hover-elevate cursor-pointer">
                      <CardContent className="p-6 flex flex-col h-full">
                        <Badge variant="secondary" className="w-fit text-xs mb-3">
                          {post.category}
                        </Badge>
                        <h2 className="text-lg font-semibold mb-2 leading-snug">{post.title}</h2>
                        <p className="text-sm text-muted-foreground mb-4 flex-1">{post.excerpt}</p>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground pt-4 border-t">
                          <span className="flex items-center gap-1">
                            <CalendarDays className="w-3.5 h-3.5" />
                            {formatDate(post.date)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {post.readTime}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                </StaggerItem>
              ))}
            </StaggerGroup>
          </div>
        </section>

        <Reveal variants={fadeUp}>
          <section className="py-16 lg:py-20 bg-muted/30" data-testid="section-blog-cta">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
              <h2 className="heading-section mb-4">Want guides you can actually use?</h2>
              <p className="text-muted-foreground mb-6">
                Check out our Resources hub for templates, playbooks, and quick references you can copy
                straight into your workflow.
              </p>
              <Link
                href="/resources"
                className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-6 py-3 text-sm font-medium hover-elevate"
                data-testid="link-blog-cta-resources"
              >
                Browse Resources
              </Link>
            </div>
          </section>
        </Reveal>
      </main>
      <SiteFooter />
    </div>
  );
}
