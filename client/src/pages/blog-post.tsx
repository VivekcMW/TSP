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
import { blogPostJsonLd, blogPostTools, getBlogPost, getRelatedPosts, headingAnchor, HEADING_PREFIX, isHeading } from "@/lib/blog-posts";
import { relatedPageLabel } from "@shared/audience-pages";
import { ArrowLeft, ArrowRight, CalendarDays, Clock, Sparkles } from "lucide-react";

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
  const headings = post.content.filter(isHeading);
  const firstParagraph = post.content.findIndex(block => !isHeading(block));
  const relatedPages = (post.relatedPages ?? []).flatMap(path => {
    const label = relatedPageLabel(path);
    return label ? [{ path, label }] : [];
  });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO
        title={post.seoTitle ?? post.title}
        canonical={`/blog/${post.slug}`}
        description={post.excerpt}
        type="article"
        jsonLd={blogPostJsonLd(post)}
      />
      <SiteHeader />
      <main className="flex-1">
        <article className="bg-card" data-testid="section-blog-post">
          <div className="mx-auto max-w-5xl px-4 pb-16 pt-12 sm:px-6 lg:pb-24 lg:pt-16">
            <nav aria-label="Breadcrumb" className="mb-12">
              <ol className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <li><Link href="/" className="transition-colors hover:text-primary">Home</Link></li>
                <li aria-hidden="true">/</li>
                <li>
                  <Link href="/blog" className="inline-flex items-center gap-1.5 transition-colors hover:text-primary" data-testid="link-back-to-blog">
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />Journal
                  </Link>
                </li>
                <li aria-hidden="true">/</li>
                <li className="font-medium text-foreground" aria-current="page">{post.category}</li>
              </ol>
            </nav>

            <div className="grid items-end gap-10 lg:grid-cols-[1fr_0.3fr]">
              <div>
                <Badge className="border-0 bg-primary/10 text-primary">{post.category}</Badge>
                <h1 className="mt-6 max-w-4xl font-heading text-5xl font-semibold leading-[1.02] tracking-tight text-foreground sm:text-6xl lg:text-7xl" data-testid="text-blog-post-title">
                  {post.title}
                </h1>
                <p className="mt-6 max-w-3xl text-xl leading-8 text-muted-foreground">{post.excerpt}</p>
              </div>
              <div className="border-l-2 border-primary pl-5 text-sm leading-6 text-muted-foreground">
                <p className="font-semibold text-foreground">{post.author}</p>
                <p>{post.authorRole}</p>
                <div className="mt-4 space-y-2">
                  <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4" aria-hidden="true" /><time dateTime={post.date}>{formatDate(post.date)}</time></p>
                  {post.updated && post.updated !== post.date && <p>Updated <time dateTime={post.updated}>{formatDate(post.updated)}</time></p>}
                  <p className="flex items-center gap-2"><Clock className="h-4 w-4" aria-hidden="true" />{post.readTime}</p>
                </div>
              </div>
            </div>
          </div>
        </article>

        <article className="mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:py-20">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_13rem]">
            <div className="min-w-0 lg:col-start-1">
              {post.summary && (
                <section aria-labelledby="short-answer" className="mb-10 max-w-2xl rounded-card border border-primary/20 bg-primary/5 p-6" data-testid="blog-post-summary">
                  <h2 id="short-answer" className="text-sm font-bold uppercase tracking-[0.16em] text-primary">The short answer</h2>
                  <p className="mt-3 text-lg leading-8 text-foreground">{post.summary}</p>
                </section>
              )}
              {headings.length > 2 && (
                <nav aria-labelledby="contents-title" className="mb-10 max-w-2xl border-l-2 pl-5">
                  <h2 id="contents-title" className="text-sm font-bold uppercase tracking-[0.16em] text-muted-foreground">In this guide</h2>
                  <ol className="mt-3 space-y-2">
                    {headings.map(heading => (
                      <li key={heading}><a href={`#${headingAnchor(heading)}`} className="text-primary hover:underline">{heading.slice(HEADING_PREFIX.length)}</a></li>
                    ))}
                  </ol>
                </nav>
              )}
              <div className="prose prose-neutral max-w-2xl dark:prose-invert">
                {post.content.map((block, index) => isHeading(block) ? (
                  <h2 key={index} id={headingAnchor(block)} className="mt-12 scroll-mt-24 font-heading text-3xl font-semibold text-foreground">{block.slice(HEADING_PREFIX.length)}</h2>
                ) : (
                  <p key={index} className={`text-lg leading-8 text-foreground/85 ${index === firstParagraph && !post.summary ? "first-letter:float-left first-letter:mr-2 first-letter:mt-1 first-letter:font-heading first-letter:text-6xl first-letter:font-semibold first-letter:leading-[0.8] first-letter:text-primary" : ""}`}>
                    {block}
                  </p>
                ))}
              </div>
              {post.faqs && post.faqs.length > 0 && (
                <section aria-labelledby="post-faq-title" className="mt-14 max-w-2xl">
                  <h2 id="post-faq-title" className="font-heading text-3xl font-semibold">Frequently asked questions</h2>
                  <div className="mt-6 divide-y border-y">
                    {post.faqs.map(faq => (
                      <div key={faq.question} className="py-5">
                        <h3 className="font-semibold text-foreground">{faq.question}</h3>
                        <p className="mt-2 leading-7 text-muted-foreground">{faq.answer}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {relatedPages.length > 0 && (
                <section aria-labelledby="post-related-pages" className="mt-14 max-w-2xl">
                  <h2 id="post-related-pages" className="font-heading text-2xl font-semibold">Put it into practice</h2>
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {relatedPages.map(link => (
                      <li key={link.path}>
                        <Link href={link.path} className="inline-flex min-h-11 items-center gap-1 rounded-full border bg-card px-4 text-sm font-medium hover:border-primary/40 hover:text-primary">
                          {link.label}<ArrowRight className="h-4 w-4" aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section aria-labelledby="post-free-tools" className="mt-14 max-w-2xl" data-testid="blog-post-tools">
                <h2 id="post-free-tools" className="font-heading text-2xl font-semibold">Free tools for your next post</h2>
                <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                  {blogPostTools(post).map(tool => (
                    <li key={tool.path}>
                      <Link href={tool.path} className="flex h-full flex-col rounded-card border bg-card p-4 transition-colors hover:border-primary/40">
                        <span className="font-semibold text-foreground">{tool.name}</span>
                        <span className="mt-1 text-sm text-muted-foreground">{tool.summary}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link href="/tools" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">All free tools<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
              </section>
            </div>
            <aside className="hidden self-start border-l pl-6 text-sm text-muted-foreground lg:block">
              <p className="font-semibold text-foreground">In this story</p>
              <p className="mt-3 leading-6">A considered take on {post.category.toLowerCase()}, written for people building their reputation in public.</p>
              <Link href="/blog" className="mt-6 inline-flex items-center gap-1.5 font-semibold text-primary hover:underline">
                More stories <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </aside>
          </div>

          <Reveal>
            <Card className="mt-16 overflow-hidden border-primary/20 bg-primary/5">
              <CardContent className="flex flex-col justify-between gap-5 p-6 sm:flex-row sm:items-center sm:p-8">
                <div>
                  <p className="font-semibold">Ready to put this into practice?</p>
                  <p className="mt-1 text-sm text-muted-foreground">Turn your next strong opinion into a post worth remembering.</p>
                </div>
                <Button asChild className="shrink-0">
                  <Link href="/sign-up" data-testid="link-blog-post-signup">
                    <Sparkles className="mr-2 h-4 w-4" />
                    Start free
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </Reveal>
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
