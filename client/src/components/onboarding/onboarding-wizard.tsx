import { useState } from "react";
import { MessageCircle, Newspaper, Brain, Users, Check, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface OnboardingWizardProps {
  onComplete: (data: OnboardingData) => void;
  isPending?: boolean;
}

interface OnboardingData {
  focusDescription: string;
  publications: string[];
  keywords: string[];
  influencers: string[];
  companies: string[];
}

const samplePublications = [
  "TechCrunch", "The Verge", "Harvard Business Review", "Forbes", "Wired",
  "MIT Technology Review", "Fast Company", "Bloomberg", "The Information", "Axios",
  "VentureBeat", "Protocol", "The Hustle", "Morning Brew", "Stratechery",
  "A16Z Blog", "First Round Review", "Hacker News", "Product Hunt", "Indie Hackers"
];

const sampleKeywords = [
  "AI", "Machine Learning", "Product Management", "Startup Growth", "B2B SaaS",
  "Leadership", "Remote Work", "Developer Tools", "Fundraising", "GTM Strategy",
  "Customer Success", "Data Science", "Cloud Computing", "Fintech", "Web3",
  "Product-Led Growth", "Design Thinking", "Agile", "DevOps", "Cybersecurity"
];

const sampleInfluencers = [
  "Satya Nadella", "Jensen Huang", "Sam Altman", "Tobi Lutke", "Brian Chesky",
  "David Sacks", "Jason Calacanis", "Naval Ravikant", "Paul Graham", "Marc Andreessen",
  "Reid Hoffman", "Elad Gil", "Lenny Rachitsky", "Shreyas Doshi", "Julie Zhuo",
  "Andrew Chen", "Casey Winters", "Hiten Shah", "Jason Fried", "DHH"
];

const sampleCompanies = [
  "OpenAI", "Anthropic", "Stripe", "Notion", "Figma",
  "Linear", "Vercel", "Supabase", "Retool", "Airtable",
  "Shopify", "Salesforce", "HubSpot", "Datadog", "Snowflake",
  "Confluent", "MongoDB", "Cloudflare", "Twilio", "Plaid"
];

export function OnboardingWizard({ onComplete, isPending = false }: OnboardingWizardProps) {
  const [focusDescription, setFocusDescription] = useState("");
  const [selectedPublications, setSelectedPublications] = useState<string[]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [selectedInfluencers, setSelectedInfluencers] = useState<string[]>([]);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [customKeyword, setCustomKeyword] = useState("");
  const [customInfluencer, setCustomInfluencer] = useState("");
  const [customCompany, setCustomCompany] = useState("");
  const [isGeneratingRecommendations, setIsGeneratingRecommendations] = useState(false);
  const [hasGeneratedRecommendations, setHasGeneratedRecommendations] = useState(false);
  const { toast } = useToast();

  const generateRecommendations = async () => {
    if (focusDescription.length < 20) return;
    
    setIsGeneratingRecommendations(true);
    
    try {
      const response = await apiRequest("POST", "/api/ai/analyze-identity", {
        focusDescription,
      });
      
      const data = await response.json();
      
      setSelectedPublications(data.publications || samplePublications.slice(0, 8));
      setSelectedKeywords(data.keywords || sampleKeywords.slice(0, 8));
      setSelectedInfluencers(data.personalities || sampleInfluencers.slice(0, 8));
      setSelectedCompanies(data.companies || sampleCompanies.slice(0, 8));
      setHasGeneratedRecommendations(true);
      
      toast({
        title: "Recommendations generated",
        description: `Identified industry: ${data.primaryIndustry || "General"}`,
      });
    } catch (error) {
      console.error("Error generating recommendations:", error);
      
      setSelectedPublications(samplePublications.slice(0, 8));
      setSelectedKeywords(sampleKeywords.slice(0, 8));
      setSelectedInfluencers(sampleInfluencers.slice(0, 8));
      setSelectedCompanies(sampleCompanies.slice(0, 8));
      setHasGeneratedRecommendations(true);
      
      toast({
        title: "Using default recommendations",
        description: "We couldn't analyze your profile, but here are some suggestions to get started.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingRecommendations(false);
    }
  };

  const toggleItem = (item: string, list: string[], setList: (items: string[]) => void) => {
    if (list.includes(item)) {
      setList(list.filter(i => i !== item));
    } else {
      setList([...list, item]);
    }
  };

  const addCustomItem = (value: string, list: string[], setList: (items: string[]) => void, setValue: (v: string) => void) => {
    const trimmed = value.trim();
    if (trimmed && !list.includes(trimmed)) {
      setList([...list, trimmed]);
      setValue("");
    }
  };

  const handleComplete = () => {
    onComplete({
      focusDescription,
      publications: selectedPublications,
      keywords: selectedKeywords,
      influencers: selectedInfluencers,
      companies: selectedCompanies,
    });
  };

  const isValid = focusDescription.length >= 10 && 
    (selectedPublications.length > 0 || selectedKeywords.length > 0);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12 space-y-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold mb-3" data-testid="text-onboarding-title">
            Set up your profile
          </h1>
          <p className="text-muted-foreground">
            Tell us about yourself so we can curate the perfect content for you.
          </p>
        </div>

        <Card data-testid="section-identity">
          <CardHeader className="flex flex-row items-start gap-4 space-y-0">
            <div className="w-10 h-10 rounded-md bg-yellow-500/10 flex items-center justify-center flex-shrink-0">
              <MessageCircle className="w-5 h-5 text-yellow-500" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-lg">Who are you?</CardTitle>
              <CardDescription className="mt-1">
                Describe your role, expertise, and what topics you want to be known for.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={focusDescription}
              onChange={(e) => setFocusDescription(e.target.value)}
              placeholder="e.g., I'm a VP of Product at a fintech startup. I care about cross-border payments, regulatory shifts, and product-led growth."
              className="min-h-[100px] resize-none"
              maxLength={200}
              data-testid="textarea-focus-description"
            />
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <span className="text-xs text-muted-foreground">
                {focusDescription.length} / 200
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={generateRecommendations}
                disabled={focusDescription.length < 20 || isGeneratingRecommendations}
                data-testid="button-generate-recommendations"
              >
                {isGeneratingRecommendations ? (
                  <>
                    <Sparkles className="w-4 h-4 mr-2 animate-pulse" />
                    Generating...
                  </>
                ) : hasGeneratedRecommendations ? (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Regenerate Recommendations
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate Recommendations
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {hasGeneratedRecommendations && (
          <>
            <Card data-testid="section-sources">
              <CardHeader className="flex flex-row items-start gap-4 space-y-0">
                <div className="w-10 h-10 rounded-md bg-red-500/10 flex items-center justify-center flex-shrink-0">
                  <Newspaper className="w-5 h-5 text-red-500" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-lg">Where do you get your news?</CardTitle>
                  <CardDescription className="mt-1">
                    Select publications and sources you trust and want us to monitor.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {samplePublications.map((pub) => (
                    <Badge
                      key={pub}
                      variant={selectedPublications.includes(pub) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleItem(pub, selectedPublications, setSelectedPublications)}
                      data-testid={`badge-pub-${pub.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      {selectedPublications.includes(pub) && <Check className="w-3 h-3 mr-1" />}
                      {pub}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="section-topics">
              <CardHeader className="flex flex-row items-start gap-4 space-y-0">
                <div className="w-10 h-10 rounded-md bg-pink-500/10 flex items-center justify-center flex-shrink-0">
                  <Brain className="w-5 h-5 text-pink-500" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-lg">What topics interest you?</CardTitle>
                  <CardDescription className="mt-1">
                    Pick keywords that match your expertise and the themes you want to post about.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {sampleKeywords.map((keyword) => (
                    <Badge
                      key={keyword}
                      variant={selectedKeywords.includes(keyword) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleItem(keyword, selectedKeywords, setSelectedKeywords)}
                      data-testid={`badge-keyword-${keyword.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      {selectedKeywords.includes(keyword) && <Check className="w-3 h-3 mr-1" />}
                      {keyword}
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={customKeyword}
                    onChange={(e) => setCustomKeyword(e.target.value)}
                    placeholder="Add custom topic..."
                    className="flex-1"
                    onKeyDown={(e) => e.key === "Enter" && addCustomItem(customKeyword, selectedKeywords, setSelectedKeywords, setCustomKeyword)}
                    data-testid="input-custom-keyword"
                  />
                  <Button
                    variant="outline"
                    onClick={() => addCustomItem(customKeyword, selectedKeywords, setSelectedKeywords, setCustomKeyword)}
                    disabled={!customKeyword.trim()}
                    data-testid="button-add-keyword"
                  >
                    Add
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="section-connections">
              <CardHeader className="flex flex-row items-start gap-4 space-y-0">
                <div className="w-10 h-10 rounded-md bg-green-500/10 flex items-center justify-center flex-shrink-0">
                  <Users className="w-5 h-5 text-green-500" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-lg">Who inspires you?</CardTitle>
                  <CardDescription className="mt-1">
                    Select influencers and companies whose content and perspectives you admire.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <p className="text-sm font-medium mb-3">Thought Leaders</p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {sampleInfluencers.map((influencer) => (
                      <Badge
                        key={influencer}
                        variant={selectedInfluencers.includes(influencer) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => toggleItem(influencer, selectedInfluencers, setSelectedInfluencers)}
                        data-testid={`badge-influencer-${influencer.toLowerCase().replace(/\s+/g, '-')}`}
                      >
                        {selectedInfluencers.includes(influencer) && <Check className="w-3 h-3 mr-1" />}
                        {influencer}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={customInfluencer}
                      onChange={(e) => setCustomInfluencer(e.target.value)}
                      placeholder="Add someone else..."
                      className="flex-1"
                      onKeyDown={(e) => e.key === "Enter" && addCustomItem(customInfluencer, selectedInfluencers, setSelectedInfluencers, setCustomInfluencer)}
                      data-testid="input-custom-influencer"
                    />
                    <Button
                      variant="outline"
                      onClick={() => addCustomItem(customInfluencer, selectedInfluencers, setSelectedInfluencers, setCustomInfluencer)}
                      disabled={!customInfluencer.trim()}
                      data-testid="button-add-influencer"
                    >
                      Add
                    </Button>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium mb-3">Companies to Watch</p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {sampleCompanies.map((company) => (
                      <Badge
                        key={company}
                        variant={selectedCompanies.includes(company) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => toggleItem(company, selectedCompanies, setSelectedCompanies)}
                        data-testid={`badge-company-${company.toLowerCase().replace(/\s+/g, '-')}`}
                      >
                        {selectedCompanies.includes(company) && <Check className="w-3 h-3 mr-1" />}
                        {company}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={customCompany}
                      onChange={(e) => setCustomCompany(e.target.value)}
                      placeholder="Add a company..."
                      className="flex-1"
                      onKeyDown={(e) => e.key === "Enter" && addCustomItem(customCompany, selectedCompanies, setSelectedCompanies, setCustomCompany)}
                      data-testid="input-custom-company"
                    />
                    <Button
                      variant="outline"
                      onClick={() => addCustomItem(customCompany, selectedCompanies, setSelectedCompanies, setCustomCompany)}
                      disabled={!customCompany.trim()}
                      data-testid="button-add-company"
                    >
                      Add
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

          <div className="sticky bottom-0 bg-background/95 backdrop-blur py-4 border-t -mx-4 px-4">
            <Button
              size="lg"
              className="w-full"
              onClick={handleComplete}
              disabled={!isValid || isPending}
              data-testid="button-complete-onboarding"
            >
              {isPending ? (
                <>
                  <Sparkles className="w-4 h-4 mr-2 animate-pulse" />
                  Creating your inbox...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Complete Setup
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground text-center mt-2">
              You can update these preferences anytime in settings.
            </p>
          </div>
        </>
        )}
      </div>
    </div>
  );
}
