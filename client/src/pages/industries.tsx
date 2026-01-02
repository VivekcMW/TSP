import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { SEO } from "@/components/seo";
import { 
  Megaphone, Building2, Stethoscope, Landmark, ShoppingBag, Cpu, 
  Check, ArrowRight, Briefcase, Scale, Plane, GraduationCap, Sparkles,
  Brain, Zap
} from "lucide-react";

const industries = [
  {
    icon: Megaphone,
    title: "Media & Advertising",
    slug: "media-advertising",
    description: "Stay ahead of trends in digital marketing, programmatic ads, and brand strategy. Perfect for marketing directors, media planners, and agency professionals.",
    sources: ["AdAge", "Marketing Week", "The Drum", "Digiday", "AdExchanger"],
    topics: ["Programmatic Advertising", "Brand Strategy", "Content Marketing", "Social Media Trends"],
  },
  {
    icon: Cpu,
    title: "Technology & SaaS",
    slug: "technology-saas",
    description: "AI, cloud computing, developer tools, and enterprise software news for tech leaders and innovators.",
    sources: ["TechCrunch", "The Verge", "Wired", "Ars Technica", "VentureBeat"],
    topics: ["Artificial Intelligence", "Cloud Computing", "SaaS Growth", "Developer Tools"],
  },
  {
    icon: Landmark,
    title: "Finance & Banking",
    slug: "finance-banking",
    description: "Banking, fintech, investment trends, and regulatory changes for finance professionals.",
    sources: ["Financial Times", "Bloomberg", "WSJ", "The Economist", "Finextra"],
    topics: ["Digital Banking", "Investment Strategy", "Fintech Innovation", "Regulatory Compliance"],
  },
  {
    icon: Stethoscope,
    title: "Healthcare & Pharma",
    slug: "healthcare-pharma",
    description: "Digital health, biotech breakthroughs, and healthcare policy for medical and pharma professionals.",
    sources: ["STAT News", "Fierce Pharma", "Healthcare Dive", "MedPage Today", "BioPharma Dive"],
    topics: ["Digital Health", "Drug Development", "Healthcare Policy", "Medical Technology"],
  },
  {
    icon: ShoppingBag,
    title: "E-commerce & Retail",
    slug: "ecommerce-retail",
    description: "DTC brands, marketplace trends, and retail technology for commerce leaders.",
    sources: ["Retail Dive", "Modern Retail", "eMarketer", "Chain Store Age", "Digital Commerce 360"],
    topics: ["DTC Strategy", "Marketplace Trends", "Retail Technology", "Consumer Behavior"],
  },
  {
    icon: Briefcase,
    title: "Consulting & Services",
    slug: "consulting-services",
    description: "Professional services, management consulting, and business strategy insights.",
    sources: ["Harvard Business Review", "McKinsey Insights", "Consulting Magazine", "Forbes"],
    topics: ["Business Strategy", "Digital Transformation", "Leadership", "Client Success"],
  },
  {
    icon: Scale,
    title: "Legal Services",
    slug: "legal-services",
    description: "Legal tech, regulatory updates, and practice management for legal professionals.",
    sources: ["Law360", "Above the Law", "Legal Tech News", "American Lawyer", "Reuters Legal"],
    topics: ["Legal Technology", "Regulatory Changes", "Practice Management", "M&A Law"],
  },
  {
    icon: Plane,
    title: "Hospitality & Travel",
    slug: "hospitality-travel",
    description: "Travel trends, hospitality innovation, and tourism insights for industry professionals.",
    sources: ["Skift", "Hotel News Now", "Travel Weekly", "Hospitality Net", "PhocusWire"],
    topics: ["Travel Technology", "Hotel Management", "Tourism Trends", "Guest Experience"],
  },
  {
    icon: Building2,
    title: "Real Estate",
    slug: "real-estate",
    description: "PropTech, commercial real estate, and market analysis for property professionals.",
    sources: ["Bisnow", "Commercial Observer", "The Real Deal", "GlobeSt", "Inman"],
    topics: ["PropTech", "Commercial Real Estate", "Market Analysis", "Property Investment"],
  },
  {
    icon: GraduationCap,
    title: "Education & EdTech",
    slug: "education-edtech",
    description: "EdTech innovation, online learning trends, and education policy updates.",
    sources: ["EdSurge", "Inside Higher Ed", "Education Week", "eLearning Industry", "EdTech Magazine"],
    topics: ["Online Learning", "EdTech Platforms", "Higher Education", "K-12 Innovation"],
  },
  {
    icon: Briefcase,
    title: "Product Marketing",
    slug: "product-marketing",
    description: "Product-led growth, go-to-market strategies, and marketing automation insights.",
    sources: ["Product-Led Growth", "HubSpot Blog", "MarketingProfs", "Product School", "OpenView"],
    topics: ["PLG Strategy", "Go-to-Market", "Marketing Automation", "Product Positioning"],
  },
];

export default function IndustriesPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO 
        title="Industries"
        canonical="/industries"
        description="TheSocialPundit supports professionals across 11 industries with AI-powered content curation and post generation. From technology to healthcare, we've got you covered."
      />
      <SiteHeader />
      <main className="flex-1">
        <section className="py-16 lg:py-24" data-testid="section-industries-hero">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <Badge className="mb-6 bg-primary/10 text-primary border-0">
              <Sparkles className="w-3 h-3 mr-1" />
              11 Industries Powered by AI
            </Badge>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-6" data-testid="text-industries-title">
              Industry-specific AI that knows your field
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Our AI curates news from trusted sources in your industry and generates posts that sound like you wrote them. No generic content. No hallucinations. Just relevant, timely insights.
            </p>
          </div>
        </section>

        <section className="pb-8" data-testid="section-ai-features">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <Brain className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">Gemini 2.5 Flash</h3>
                  <p className="text-sm text-muted-foreground">Powered by Google's latest AI for accurate, nuanced content generation</p>
                </CardContent>
              </Card>
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <Zap className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">Real-time RSS Feeds</h3>
                  <p className="text-sm text-muted-foreground">Live content from 80+ industry publications, updated continuously</p>
                </CardContent>
              </Card>
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <Sparkles className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">4 Tonalities</h3>
                  <p className="text-sm text-muted-foreground">Thought Leader, Industry Insider, Provocateur, or Data-Driven voice</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="pb-20 lg:pb-28" data-testid="section-industries-grid">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {industries.map((industry, index) => (
                <Card 
                  key={index} 
                  className="border hover-elevate"
                  data-testid={`card-industry-${index}`}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <industry.icon className="w-6 h-6 text-primary" />
                      </div>
                      <Badge variant="default" className="text-xs" data-testid={`badge-available-${index}`}>
                        Available
                      </Badge>
                    </div>
                    <h3 className="text-lg font-semibold mb-2">{industry.title}</h3>
                    <p className="text-sm text-muted-foreground mb-4">{industry.description}</p>
                    
                    <div className="mb-4">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Sources</p>
                      <div className="flex flex-wrap gap-1">
                        {industry.sources.slice(0, 3).map((source, sIndex) => (
                          <Badge key={sIndex} variant="secondary" className="text-xs">
                            {source}
                          </Badge>
                        ))}
                        {industry.sources.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{industry.sources.length - 3} more
                          </Badge>
                        )}
                      </div>
                    </div>

                    <ul className="space-y-1.5 mb-6">
                      {industry.topics.map((topic, tIndex) => (
                        <li key={tIndex} className="flex items-center gap-2 text-sm">
                          <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                          <span className="text-muted-foreground">{topic}</span>
                        </li>
                      ))}
                    </ul>

                    <Link href="/register">
                      <Button className="w-full" data-testid={`button-get-started-${index}`}>
                        Get Started
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16 lg:py-20 bg-muted/30" data-testid="section-industries-cta">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold mb-4">
              Ready to build your authority?
            </h2>
            <p className="text-muted-foreground mb-6">
              Join thousands of professionals using AI to stay visible on LinkedIn and Twitter/X. Start posting thought leadership content in under 5 minutes.
            </p>
            <Link href="/register">
              <Button size="lg" data-testid="button-start-free">
                <Sparkles className="w-4 h-4 mr-2" />
                Start Free Today
              </Button>
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
