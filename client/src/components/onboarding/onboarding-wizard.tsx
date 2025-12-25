import { useState } from "react";
import { Linkedin, Check, ArrowRight, ArrowLeft, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface OnboardingWizardProps {
  onComplete: (data: OnboardingData) => void;
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

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const [focusDescription, setFocusDescription] = useState("");
  const [selectedPublications, setSelectedPublications] = useState<string[]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [selectedInfluencers, setSelectedInfluencers] = useState<string[]>([]);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const totalSteps = 3;
  const progress = (step / totalSteps) * 100;

  const handleLinkedInConnect = () => {
    setIsAnalyzing(true);
    setTimeout(() => {
      setIsAnalyzing(false);
      setStep(2);
    }, 1500);
  };

  const handleGenerateProfile = () => {
    setIsAnalyzing(true);
    setTimeout(() => {
      setSelectedPublications(samplePublications.slice(0, 10));
      setSelectedKeywords(sampleKeywords.slice(0, 10));
      setSelectedInfluencers(sampleInfluencers.slice(0, 10));
      setSelectedCompanies(sampleCompanies.slice(0, 10));
      setIsAnalyzing(false);
      setStep(3);
    }, 2000);
  };

  const toggleItem = (item: string, list: string[], setList: (items: string[]) => void) => {
    if (list.includes(item)) {
      setList(list.filter(i => i !== item));
    } else {
      setList([...list, item]);
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

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="sticky top-0 z-10 bg-background border-b">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Step {step} of {totalSteps}</span>
            <span className="text-sm font-medium">{Math.round(progress)}% complete</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      </div>
      
      <div className="flex-1 flex items-center justify-center py-12 px-6">
        {step === 1 && (
          <Card className="max-w-lg w-full">
            <CardHeader className="text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Linkedin className="w-8 h-8 text-primary" />
              </div>
              <CardTitle className="text-2xl" data-testid="text-onboarding-title">Set Up Your Profile in 60 Seconds</CardTitle>
              <CardDescription className="mt-2">
                Connect your LinkedIn to automatically understand your professional identity, expertise, and interests.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-3">
                  <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                  <span>We read your profile, skills, and experience</span>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                  <span>AI suggests relevant topics and publications</span>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                  <span>You can edit everything before confirming</span>
                </div>
              </div>
              
              <Button 
                className="w-full" 
                size="lg"
                onClick={handleLinkedInConnect}
                disabled={isAnalyzing}
                data-testid="button-connect-linkedin"
              >
                {isAnalyzing ? (
                  <>
                    <Sparkles className="w-4 h-4 mr-2 animate-pulse" />
                    Analyzing your profile...
                  </>
                ) : (
                  <>
                    <Linkedin className="w-4 h-4 mr-2" />
                    Connect with LinkedIn
                  </>
                )}
              </Button>
              
              <button 
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setStep(2)}
                data-testid="button-skip-linkedin"
              >
                Skip for now
              </button>
            </CardContent>
          </Card>
        )}
        
        {step === 2 && (
          <Card className="max-w-lg w-full">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl" data-testid="text-focus-title">Define Your Focus</CardTitle>
              <CardDescription className="mt-2">
                In one line, describe who you are and what you want to share opinions about.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Textarea 
                  value={focusDescription}
                  onChange={(e) => setFocusDescription(e.target.value)}
                  placeholder="e.g., I'm a product manager in fintech who wants to share insights on AI and product strategy"
                  className="min-h-[120px] resize-none"
                  maxLength={150}
                  data-testid="textarea-focus-description"
                />
                <div className="text-xs text-muted-foreground text-right">
                  {focusDescription.length} / 150 characters
                </div>
              </div>
              
              <div className="flex gap-3">
                <Button 
                  variant="outline" 
                  onClick={() => setStep(1)}
                  data-testid="button-back"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <Button 
                  className="flex-1" 
                  onClick={handleGenerateProfile}
                  disabled={focusDescription.length < 10 || isAnalyzing}
                  data-testid="button-generate-profile"
                >
                  {isAnalyzing ? (
                    <>
                      <Sparkles className="w-4 h-4 mr-2 animate-pulse" />
                      Generating your profile...
                    </>
                  ) : (
                    <>
                      Generate My Profile
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        
        {step === 3 && (
          <Card className="max-w-4xl w-full">
            <CardHeader>
              <CardTitle className="text-2xl" data-testid="text-review-title">Review Your AI-Generated Profile</CardTitle>
              <CardDescription>
                Click items to add or remove them. These will be used to curate your daily content inbox.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Tabs defaultValue="publications" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="publications" data-testid="tab-publications">
                    Publications ({selectedPublications.length})
                  </TabsTrigger>
                  <TabsTrigger value="keywords" data-testid="tab-keywords">
                    Keywords ({selectedKeywords.length})
                  </TabsTrigger>
                  <TabsTrigger value="influencers" data-testid="tab-influencers">
                    Influencers ({selectedInfluencers.length})
                  </TabsTrigger>
                  <TabsTrigger value="companies" data-testid="tab-companies">
                    Companies ({selectedCompanies.length})
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="publications" className="mt-4">
                  <div className="flex flex-wrap gap-2">
                    {samplePublications.map((pub) => (
                      <Badge 
                        key={pub}
                        variant={selectedPublications.includes(pub) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => toggleItem(pub, selectedPublications, setSelectedPublications)}
                        data-testid={`badge-pub-${pub.toLowerCase().replace(/\s+/g, '-')}`}
                      >
                        {pub}
                      </Badge>
                    ))}
                  </div>
                </TabsContent>
                
                <TabsContent value="keywords" className="mt-4">
                  <div className="flex flex-wrap gap-2">
                    {sampleKeywords.map((keyword) => (
                      <Badge 
                        key={keyword}
                        variant={selectedKeywords.includes(keyword) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => toggleItem(keyword, selectedKeywords, setSelectedKeywords)}
                        data-testid={`badge-keyword-${keyword.toLowerCase().replace(/\s+/g, '-')}`}
                      >
                        {keyword}
                      </Badge>
                    ))}
                  </div>
                </TabsContent>
                
                <TabsContent value="influencers" className="mt-4">
                  <div className="flex flex-wrap gap-2">
                    {sampleInfluencers.map((influencer) => (
                      <Badge 
                        key={influencer}
                        variant={selectedInfluencers.includes(influencer) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => toggleItem(influencer, selectedInfluencers, setSelectedInfluencers)}
                        data-testid={`badge-influencer-${influencer.toLowerCase().replace(/\s+/g, '-')}`}
                      >
                        {influencer}
                      </Badge>
                    ))}
                  </div>
                </TabsContent>
                
                <TabsContent value="companies" className="mt-4">
                  <div className="flex flex-wrap gap-2">
                    {sampleCompanies.map((company) => (
                      <Badge 
                        key={company}
                        variant={selectedCompanies.includes(company) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => toggleItem(company, selectedCompanies, setSelectedCompanies)}
                        data-testid={`badge-company-${company.toLowerCase().replace(/\s+/g, '-')}`}
                      >
                        {company}
                      </Badge>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
              
              <div className="flex gap-3 pt-4 border-t">
                <Button 
                  variant="outline" 
                  onClick={() => setStep(2)}
                  data-testid="button-back-to-focus"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <Button 
                  className="flex-1" 
                  onClick={handleComplete}
                  data-testid="button-confirm-profile"
                >
                  <Check className="w-4 h-4 mr-2" />
                  Confirm & Start
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
