import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageCircle, X } from "lucide-react";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";

const examples = [
  {
    id: "finance",
    industry: "Finance & Banking",
    platform: "LinkedIn",
    generic:
      "\"This article discusses the new regulatory framework for stablecoins. It mentions that compliance is important for the future of the industry...\"",
    genericResult: "Ignored",
    pov:
      "\"The new stablecoin framework isn't a hurdle—it's the green light institutional capital has been waiting for. If you're building for DeFi without a 2025 compliance roadmap, you're not building a business, you're building a liability.\"",
    povResult: "50+ comments",
  },
  {
    id: "healthcare",
    industry: "Healthcare & Pharma",
    platform: "LinkedIn",
    generic:
      "\"A new study shows promising results for an AI-assisted diagnostic tool. The technology could help doctors detect conditions earlier...\"",
    genericResult: "Ignored",
    pov:
      "\"This diagnostic tool doesn't replace physicians—it removes the excuse for late detection. The hospitals slow to adopt AI triage in the next 18 months won't be behind on technology, they'll be behind on outcomes.\"",
    povResult: "40+ comments",
  },
];

export function AIPov() {
  return (
    <section className="py-20 lg:py-28 bg-muted/30" data-testid="section-ai-pov">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="text-center mb-16">
          <h2 className="heading-section mb-4">
            Your voice. Your POV. Not generic AI slop.
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Our AI reads real articles from 80+ industry publications, understands context, and generates posts in 4 distinct tonalities. Choose Thought Leader, Industry Insider, Provocateur, or Data-Driven.
          </p>
        </Reveal>

        <Reveal delay={0.1}>
          <Tabs defaultValue={examples[0].id} className="w-full">
            <TabsList className="mx-auto mb-10 grid w-full max-w-md grid-cols-2">
              {examples.map((example) => (
                <TabsTrigger
                  key={example.id}
                  value={example.id}
                  data-testid={`tab-ai-pov-${example.id}`}
                >
                  {example.industry}
                </TabsTrigger>
              ))}
            </TabsList>

            {examples.map((example) => (
              <TabsContent key={example.id} value={example.id} className="mt-0">
                <StaggerGroup className="grid md:grid-cols-2 gap-6 lg:gap-8 items-stretch">
                  <StaggerItem>
                    <Card className="h-full border-dashed bg-muted/40">
                      <CardContent className="p-6 lg:p-8 h-full flex flex-col">
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-5 h-5 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                            <X className="w-3 h-3 text-destructive" />
                          </div>
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            Generic AI Response
                          </p>
                        </div>
                        <p className="text-muted-foreground line-through flex-1">{example.generic}</p>
                        <Badge variant="outline" className="text-destructive border-destructive/30 w-fit mt-6">
                          Result: {example.genericResult}
                        </Badge>
                      </CardContent>
                    </Card>
                  </StaggerItem>

                  <StaggerItem>
                    <Card className="h-full border-2 border-secondary/40 bg-background hover-lift">
                      <CardContent className="p-6 lg:p-8 h-full flex flex-col">
                        <div className="flex items-center justify-between gap-2 mb-4">
                          <p className="text-xs font-semibold text-secondary uppercase tracking-wide">
                            Social Pundit POV
                          </p>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {example.platform}
                          </Badge>
                        </div>
                        <p className="flex-1">{example.pov}</p>
                        <div className="flex items-center gap-1.5 text-sm font-medium text-secondary mt-6">
                          <MessageCircle className="w-3.5 h-3.5" />
                          {example.povResult}
                        </div>
                      </CardContent>
                    </Card>
                  </StaggerItem>
                </StaggerGroup>
              </TabsContent>
            ))}
          </Tabs>
        </Reveal>
      </div>
    </section>
  );
}


