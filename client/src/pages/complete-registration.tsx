import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowRight, Check, Linkedin, Sparkles } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import { track } from "@/lib/analytics-consent";

const presets = [
  {
    id: "ai-saas",
    label: "AI & SaaS",
    industry: "technology_saas" as const,
    focus: "AI, SaaS, product innovation, enterprise adoption, startups, and funding for LinkedIn.",
    keywords: ["Artificial Intelligence", "Agentic AI", "SaaS", "Enterprise AI", "Startup funding"],
  },
  {
    id: "marketing-growth",
    label: "Marketing & Growth",
    industry: "product_marketing" as const,
    focus: "Marketing strategy, growth, customer experience, brand building, and AI-powered go-to-market.",
    keywords: ["Marketing strategy", "Growth", "Brand building", "Customer experience", "Go-to-market"],
  },
  {
    id: "leadership",
    label: "Leadership & Business",
    industry: "consulting_services" as const,
    focus: "Leadership, workplace change, business strategy, and practical lessons for professionals.",
    keywords: ["Leadership", "Business strategy", "Future of work", "Organisational change"],
  },
  {
    id: "startups-funding",
    label: "Startups & Funding",
    industry: "technology_saas" as const,
    focus: "Startup funding, founder strategy, venture capital, and technology business models.",
    keywords: ["Startup funding", "Venture capital", "Founder strategy", "Technology startups"],
  },
];
const STOP_WORDS = new Set(["the", "and", "for", "with", "from", "that", "this", "into", "about", "want", "work", "help", "your", "linkedin"]);
function inferIndustry(focus: string) {
  const normalized = focus.toLocaleLowerCase();
  if (/(marketing|growth|brand|go-to-market|customer acquisition)/.test(normalized)) return "product_marketing" as const;
  if (/(finance|banking|venture|investment|accounting)/.test(normalized)) return "finance_banking" as const;
  if (/(health|pharma|medical|clinical)/.test(normalized)) return "healthcare_pharma" as const;
  if (/(advertising|media|creator|entertainment)/.test(normalized)) return "media_advertising" as const;
  if (/(leadership|executive|strategy|management|consulting)/.test(normalized)) return "consulting_services" as const;
  return "technology_saas" as const;
}

interface CompleteRegistrationProps {
  existingFirstName?: string | null;
  existingLastName?: string | null;
  existingName?: string | null;
}

export default function CompleteRegistrationPage({ existingFirstName, existingLastName, existingName }: CompleteRegistrationProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const nameParts = (existingName || "").trim().split(/\s+/).filter(Boolean);
  const firstName = existingFirstName || nameParts[0] || "User";
  const lastName = existingLastName || nameParts.slice(1).join(" ") || "Member";
  const [focus, setFocus] = useState("");
  const [presetId, setPresetId] = useState<string>();
  const [country, setCountry] = useState("Global");
  const selected = useMemo(() => presets.find(preset => preset.id === presetId), [presetId]);

  const completeRegistrationMutation = useMutation({
    mutationFn: async () => {
      const inferredKeywords = focus
        .split(/[,\n.;:!?]|\s+/)
        .map(value => value.trim().replace(/[^\p{L}\p{N}&-]/gu, ""))
        .filter(value => value.length >= 3 && !STOP_WORDS.has(value.toLocaleLowerCase()))
        .filter((value, index, values) => values.findIndex(item => item.toLocaleLowerCase() === value.toLocaleLowerCase()) === index)
        .slice(0, 5);
      const inferred = selected ?? {
        industry: inferIndustry(focus),
        keywords: inferredKeywords,
      };
      const keywords = inferred.keywords.length ? inferred.keywords : ["LinkedIn thought leadership", "Industry news"];
      return await apiRequest("POST", "/api/onboarding/quick-start", {
        focusDescription: focus.trim(),
        industry: inferred.industry,
        country,
        keywords: keywords.map((keyword, index) => ({ keyword, weight: Math.max(0.55, 1 - index * 0.08) })),
      });
    },
    onSuccess: async () => {
      track("registration_complete");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/me"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/profile"] }),
      ]);
      void apiRequest("POST", "/api/inbox/refresh", { autoRefresh: false }).catch(() => undefined);
      toast({
        title: "Your LinkedIn workspace is ready",
        description: "Pundit is finding stories for your focus.",
      });
      setLocation("/dashboard/discover");
    },
    onError: (error: any) => {
      const message = error?.message || "Please try again.";
      const isUserNotFound = message.includes("not found");
      toast({
        title: isUserNotFound ? "Account Not Found" : "Something went wrong",
        description: isUserNotFound 
          ? "Your account was not found. Please sign up again." 
          : message,
        variant: "destructive",
      });
      if (isUserNotFound) {
        setTimeout(() => setLocation("/sign-up"), 2000);
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (focus.trim().length >= 10) completeRegistrationMutation.mutate();
  };

  const isValid = focus.trim().length >= 10;

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-background px-4 py-6 sm:px-6 lg:py-10">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-primary/10 via-primary/5 to-transparent" />
      <Reveal className="relative mx-auto grid min-h-[calc(100dvh-3rem)] w-full max-w-5xl grid-cols-1 items-center gap-8 lg:min-h-[calc(100dvh-5rem)] lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,1fr)] lg:gap-14">
        <section className="hidden space-y-6 lg:block" aria-labelledby="onboarding-welcome-title">
          <div className="inline-flex items-center gap-2 rounded-full border bg-card/80 px-3 py-1.5 text-xs font-semibold text-primary shadow-sm backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            One choice. One click. Your LinkedIn workspace.
          </div>
          <div className="space-y-3">
            <h1 id="onboarding-welcome-title" className="max-w-xl font-heading text-4xl font-semibold tracking-tight text-foreground xl:text-5xl">
              Build your LinkedIn advantage.
            </h1>
            <p className="max-w-lg text-lg leading-relaxed text-muted-foreground">
              Choose what you want to be known for. We will set up your topics, sources, and feed automatically.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {["Choose a LinkedIn focus", "We build your feed", "Start drafting your point of view"].map((item, index) => (
              <div key={item} className="flex items-center gap-3 text-sm">
                <span className="flex h-8 w-8 items-center justify-center rounded-full border bg-card font-semibold text-primary shadow-sm">{index + 1}</span>
                <span className="font-medium">{item}</span>
              </div>
            ))}
          </div>
        </section>
        <Card className="w-full border-border/70 bg-card/95 shadow-xl shadow-primary/5 backdrop-blur">
          <CardHeader className="space-y-5 pb-4">
            <div className="space-y-2 text-center sm:text-left">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-info-subtle sm:mx-0">
                <Sparkles className="h-6 w-6 text-info" />
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-info">LinkedIn-first setup</p>
                <CardTitle className="heading-dashboard text-2xl sm:text-3xl" data-testid="text-registration-title">What do you want to talk about?</CardTitle>
              </div>
              <CardDescription className="text-sm leading-relaxed">
                Pick a starting point or write your own. You can tune everything after your workspace opens.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Choose a focus</Label>
              <div className="grid grid-cols-2 gap-2">
                {presets.map((preset) => (
                  <Button
                    key={preset.id}
                    type="button"
                    variant={presetId === preset.id ? "selected" : "outline"}
                    className="h-auto min-h-11 justify-start px-3 text-left"
                    onClick={() => { setPresetId(preset.id); setFocus(preset.focus); }}
                    data-testid={`preset-${preset.id}`}
                  >
                    {presetId === preset.id && <Check className="mr-2 h-4 w-4 shrink-0" />}
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="linkedin-focus">Or describe your focus</Label>
              <Textarea
                id="linkedin-focus"
                value={focus}
                maxLength={500}
                rows={4}
                placeholder="I want to share useful LinkedIn insights about AI and SaaS with founders in India."
                onChange={(event) => { setFocus(event.target.value); setPresetId(undefined); }}
              />
              <p className="text-xs text-muted-foreground">
                Pundit will infer your topics and sources. {Math.max(0, 500 - focus.length)} characters left.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="linkedin-market">Primary market</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger id="linkedin-market"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Global">Global</SelectItem>
                  <SelectItem value="India">India</SelectItem>
                  <SelectItem value="United States">United States</SelectItem>
                  <SelectItem value="United Kingdom">United Kingdom</SelectItem>
                  <SelectItem value="Singapore">Singapore</SelectItem>
                  <SelectItem value="Australia">Australia</SelectItem>
                  <SelectItem value="United Arab Emirates">United Arab Emirates</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={!isValid || completeRegistrationMutation.isPending}
              data-testid="button-complete-registration"
            >
              {completeRegistrationMutation.isPending ? (
                <>
                  <Sparkles className="w-4 h-4 mr-2 animate-pulse" />
                  Building your LinkedIn feed...
                </>
              ) : (
                <>
                  <Linkedin className="w-4 h-4 mr-2" />
                  Create my LinkedIn workspace
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              No further setup required. Fine-tune your feed anytime in {firstName || lastName ? "your" : "the"} workspace.
            </p>
          </form>
        </CardContent>
        </Card>
      </Reveal>
    </div>
  );
}
