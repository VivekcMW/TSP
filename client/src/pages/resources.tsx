import { Link } from "wouter";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { fadeUp } from "@/lib/motion";
import { BLOG_POSTS } from "@/lib/blog-posts";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, BookOpen, Copy, Layers, Sparkles } from "lucide-react";

interface Template {
  title: string;
  description: string;
  content: string;
}

const TEMPLATES: Template[] = [
  {
    title: "Weekly Content Ritual",
    description: "A 15-minute checklist to turn one industry story into a post-ready opinion, every week.",
    content:
      "1. Scan your industry feed for the one story you have a real opinion on.\n2. Write your take in one sentence: is this good or bad, and for whom?\n3. Draft 3-4 short paragraphs expanding on that take.\n4. Pick the platforms where this take fits (LinkedIn, Mastodon, Reddit, etc.).\n5. Schedule for a time you can reply to comments within the first hour.",
  },
  {
    title: "Hook Formula Cheat Sheet",
    description: "Five proven opening-line patterns to stop the scroll before someone reads the rest.",
    content:
      "1. The contrarian take: \"Everyone says X. I think that's backwards.\"\n2. The specific number: \"We tested this for 90 days. Here's what happened.\"\n3. The direct question: \"Why does nobody talk about [industry blind spot]?\"\n4. The confession: \"I got this wrong for two years.\"\n5. The prediction: \"In 12 months, this will be table stakes. Here's why.\"",
  },
  {
    title: "Hashtag Strategy by Platform",
    description: "How many hashtags to use (and when to use zero) across every platform we support.",
    content:
      "LinkedIn: 3-5 hashtags, placed at the end.\nTwitter/X: 1-2 hashtags max, inline if natural.\nThreads: 2-3 hashtags, casual tone.\nBluesky: 0-1 hashtags, discovery works differently here.\nMastodon: 2-3 hashtags, essential for federated discovery.\nReddit: 0 hashtags, never — use flair and community norms instead.\nDev.to / Hashnode: 0 hashtags in body — use the platform's tag picker instead.",
  },
];

export default function ResourcesPage() {
  const { toast } = useToast();
  const guides = BLOG_POSTS.filter((post) => post.isGuide);

  function handleCopy(template: Template) {
    navigator.clipboard.writeText(template.content).then(() => {
      toast({ title: "Copied to clipboard", description: template.title });
    });
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO
        title="Resources"
        canonical="/resources"
        description="Free guides, templates, and playbooks for building professional authority across 23 platforms — from LinkedIn to Reddit, Mastodon, Weibo, and developer blogs."
      />
      <SiteHeader />
      <main className="flex-1">
        <section className="py-16 lg:py-24" data-testid="section-resources-hero">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <Badge className="mb-6 bg-primary/10 text-primary border-0">
              <Sparkles className="w-3 h-3 mr-1" />
              Free Guides &amp; Templates
            </Badge>
            <h1 className="heading-display mb-6" data-testid="text-resources-title">
              Resources to help you show up consistently
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Practical playbooks and copy-paste templates for turning industry news into thought
              leadership — no content team required.
            </p>
          </div>
        </section>

        <section className="pb-20" data-testid="section-resources-guides">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-2 mb-6">
              <BookOpen className="w-5 h-5 text-primary" />
              <h2 className="heading-section">Guides &amp; Playbooks</h2>
            </div>
            <StaggerGroup className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {guides.map((guide) => (
                <StaggerItem key={guide.slug}>
                  <Link href={`/blog/${guide.slug}`} data-testid={`link-resource-guide-${guide.slug}`}>
                    <Card className="h-full border hover-elevate cursor-pointer">
                      <CardContent className="p-6">
                        <Badge variant="secondary" className="text-xs mb-3">
                          {guide.category}
                        </Badge>
                        <h3 className="text-lg font-semibold mb-2 leading-snug">{guide.title}</h3>
                        <p className="text-sm text-muted-foreground mb-4">{guide.excerpt}</p>
                        <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                          Read Guide
                          <ArrowRight className="w-3.5 h-3.5" />
                        </span>
                      </CardContent>
                    </Card>
                  </Link>
                </StaggerItem>
              ))}
            </StaggerGroup>
          </div>
        </section>

        <section className="pb-20" data-testid="section-resources-templates">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-2 mb-6">
              <Layers className="w-5 h-5 text-primary" />
              <h2 className="heading-section">Free Templates</h2>
            </div>
            <StaggerGroup className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {TEMPLATES.map((template) => (
                <StaggerItem key={template.title}>
                  <Card className="h-full border">
                    <CardContent className="p-6 flex flex-col h-full">
                      <h3 className="text-lg font-semibold mb-2">{template.title}</h3>
                      <p className="text-sm text-muted-foreground mb-4 flex-1">{template.description}</p>
                      <pre
                        tabIndex={0}
                        role="region"
                        aria-label={`${template.title} template`}
                        className="text-xs bg-muted/50 rounded-md p-3 mb-4 whitespace-pre-wrap font-sans leading-relaxed max-h-40 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {template.content}
                      </pre>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => handleCopy(template)}
                        data-testid={`button-copy-template-${template.title.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <Copy className="w-3.5 h-3.5 mr-2" />
                        Copy Template
                      </Button>
                    </CardContent>
                  </Card>
                </StaggerItem>
              ))}
            </StaggerGroup>
          </div>
        </section>

        <Reveal variants={fadeUp}>
          <section className="py-16 lg:py-20 bg-muted/30" data-testid="section-resources-cta">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
              <h2 className="heading-section mb-4">Ready to put these into practice?</h2>
              <p className="text-muted-foreground mb-6">
                See how TheSocialPundit turns industry news into ready-to-post content across all 10
                platforms, tailored to your industry.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link href="/how-it-works" data-testid="link-resources-how-it-works">
                  <Button variant="outline" size="lg">How It Works</Button>
                </Link>
                <Link href="/sign-up" data-testid="link-resources-signup">
                  <Button size="lg">
                    <Sparkles className="w-4 h-4 mr-2" />
                    Start Free Today
                  </Button>
                </Link>
              </div>
            </div>
          </section>
        </Reveal>
      </main>
      <SiteFooter />
    </div>
  );
}
