import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO as Seo } from "@/components/seo";

interface LegalSection {
  title: string;
  content: ReactNode;
}

interface LegalPageProps {
  title: string;
  path: string;
  description: string;
  testId: string;
  sections: LegalSection[];
  /** When this page's text last changed, e.g. "October 15, 2026". */
  updated?: string;
}

export function LegalPage({ title, path, description, testId, sections, updated = "September 3, 2026" }: Readonly<LegalPageProps>) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Seo title={title} canonical={path} description={description} />
      <SiteHeader />
      <main className="flex-1">
        <article className="py-16 lg:py-24" data-testid={`section-${testId}`}>
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <h1 className="heading-display mb-4" data-testid={`text-${testId}-title`}>{title}</h1>
            <p className="mb-12 text-sm text-muted-foreground">Last updated: {updated}</p>
            <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8">
              {sections.map((section) => (
                <section key={section.title}>
                  <h2 className="heading-section !text-2xl">{section.title}</h2>
                  {section.content}
                </section>
              ))}
            </div>
          </div>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}

export const legalTextClass = "text-muted-foreground";
export const legalLinkClass = "text-primary underline";
