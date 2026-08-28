import { Link, useParams, useLocation } from "wouter";
import { useEffect } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/motion/reveal";
import { LoadingScreen } from "@/components/loading-screen";
import { getBlogPost, getRelatedPosts } from "@/lib/blog-posts";
import { ArrowLeft, CalendarDays, Clock, Sparkles } from "lucide-react";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const post = slug ? getBlogPost(slug) : undefined;

  useEffect(() => {
    if (slug && !post) {
      setLocation("/blog");
    }
  }, [slug, post, setLocation]);

  if (!post) {
    return <LoadingScreen />;
  }

  const related = getRelatedPosts(post.slug);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO title={post.title} canonical={`/blog/${post.slug}`} description={post.excerpt} type="article" />
      <SiteHeader />
      <main className="flex-1">
        <article className="py-16 lg:py-24" data-testid="section-blog-post">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <Link
              href="/blog"
              className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors mb-8"
              data-testid="link-back-to-blog"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Blog
            </Link>

            <Badge variant="secondary" className="text-xs mb-4">
              {post.category}
            </Badge>
            <h1 className="heading-display mb-4" data-testid="text-blog-post-title">
              {post.title}
            </h1>
            <div className="flex items-center gap-4 text-sm text-muted-foreground mb-10 pb-8 border-b">
              <span>
                {post.author} &middot; {post.authorRole}
              </span>
              <span className="flex items-center gap-1">
                <CalendarDays className="w-3.5 h-3.5" />
                {formatDate(post.date)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {post.readTime}
              </span>
            </div>

            <div className="prose prose-neutral dark:prose-invert max-w-none">
              {post.content.map((paragraph, index) => (
                <p key={index} className="text-base leading-relaxed text-foreground/90 mb-5">
                  {paragraph}
                </p>
              ))}
            </div>

            <Reveal>
              <Card className="mt-12 border-primary/20 bg-primary/5">
                <CardContent className="p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold mb-1">Ready to put this into practice?</p>
                    <p className="text-sm text-muted-foreground">
                      Generate on-brand posts for 23 platforms in minutes, not hours.
                    </p>
                  </div>
                  <Link href="/sign-up" data-testid="link-blog-post-signup">
                    <Button data-testid="button-blog-post-signup">
                      <Sparkles className="w-4 h-4 mr-2" />
                      Start Free
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </Reveal>
          </div>
        </article>

        {related.length > 0 && (
          <section className="pb-20 lg:pb-28" data-testid="section-related-posts">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
              <h2 className="heading-section mb-8 text-center">More from the blog</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {related.map((relatedPost) => (
                  <Link
                    key={relatedPost.slug}
                    href={`/blog/${relatedPost.slug}`}
                    data-testid={`link-related-post-${relatedPost.slug}`}
                  >
                    <Card className="h-full border hover-elevate cursor-pointer">
                      <CardContent className="p-6">
                        <Badge variant="secondary" className="text-xs mb-3">
                          {relatedPost.category}
                        </Badge>
                        <h3 className="font-semibold leading-snug mb-2">{relatedPost.title}</h3>
                        <p className="text-sm text-muted-foreground line-clamp-3">{relatedPost.excerpt}</p>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
