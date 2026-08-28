import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { Card, CardContent } from "@/components/ui/card";
import { StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { Mail, ShieldQuestion } from "lucide-react";

const contactCards = [
  {
    icon: Mail,
    title: "General inquiries",
    description: "Questions about the product, your account, or anything else.",
    email: "hello@thesocialpundit.com",
  },
  {
    icon: ShieldQuestion,
    title: "Privacy requests",
    description: "Access, export, or delete your data.",
    email: "privacy@thesocialpundit.com",
  },
];

export default function ContactPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO
        title="Contact"
        canonical="/contact"
        description="Get in touch with the TheSocialPundit team."
      />
      <SiteHeader />
      <main className="flex-1">
        <section className="py-16 lg:py-24" data-testid="section-contact-hero">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="heading-display mb-6" data-testid="text-contact-title">
              Get in touch
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              Have a question, feedback, or just want to say hello? We'd love to hear from you.
            </p>
          </div>
        </section>

        <section className="pb-20 lg:pb-28" data-testid="section-contact-cards">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <StaggerGroup className="grid sm:grid-cols-2 gap-6 mb-8">
              {contactCards.map((card) => (
                <StaggerItem key={card.email}>
                  <Card className="h-full border hover-elevate">
                    <CardContent className="p-6 flex flex-col h-full">
                      <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center mb-4">
                        <card.icon className="w-5 h-5 text-primary" />
                      </div>
                      <h2 className="text-lg font-semibold mb-2">{card.title}</h2>
                      <p className="text-sm text-muted-foreground mb-4 flex-1">{card.description}</p>
                      <a
                        href={`mailto:${card.email}`}
                        className="text-sm font-medium text-primary hover:underline"
                        data-testid={`link-contact-${card.email}`}
                      >
                        {card.email}
                      </a>
                    </CardContent>
                  </Card>
                </StaggerItem>
              ))}
            </StaggerGroup>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
