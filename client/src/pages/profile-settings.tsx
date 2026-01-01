import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { User, Tag, Building2, Users, Newspaper, Sparkles, Save, Plus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { UserProfile, InboxItem } from "@shared/schema";

interface ProfileData extends UserProfile {
  aiKeywords?: string[];
}

export default function ProfileSettingsPage() {
  const { toast } = useToast();
  
  const { data: profile, isLoading: profileLoading } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
  });

  const { data: inboxItems } = useQuery<InboxItem[]>({
    queryKey: ["/api/inbox"],
  });

  const [focusDescription, setFocusDescription] = useState("");
  const [publications, setPublications] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [influencers, setInfluencers] = useState<string[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [newPublication, setNewPublication] = useState("");
  const [newKeyword, setNewKeyword] = useState("");
  const [newInfluencer, setNewInfluencer] = useState("");
  const [newCompany, setNewCompany] = useState("");

  useEffect(() => {
    if (profile) {
      setFocusDescription(profile.focusDescription || "");
      setPublications(profile.publications || []);
      setKeywords(profile.keywords || []);
      setInfluencers(profile.influencers || []);
      setCompanies(profile.companies || []);
    }
  }, [profile]);

  const aiKeywords = inboxItems?.flatMap(item => item.matchedKeywords || [])
    .filter((keyword, index, self) => self.indexOf(keyword) === index) || [];

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<UserProfile>) => {
      return apiRequest("PATCH", "/api/profile", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      toast({
        title: "Profile updated",
        description: "Your preferences have been saved.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update profile. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    updateMutation.mutate({
      focusDescription,
      publications,
      keywords,
      influencers,
      companies,
    });
  };

  const addItem = (list: string[], setList: (items: string[]) => void, newItem: string, setNewItem: (val: string) => void) => {
    const trimmed = newItem.trim();
    if (trimmed && !list.includes(trimmed)) {
      setList([...list, trimmed]);
      setNewItem("");
    }
  };

  const removeItem = (list: string[], setList: (items: string[]) => void, item: string) => {
    setList(list.filter(i => i !== item));
  };

  const addAiKeywordToProfile = (keyword: string) => {
    if (!keywords.includes(keyword)) {
      setKeywords([...keywords, keyword]);
      toast({
        title: "Keyword added",
        description: `"${keyword}" has been added to your keywords.`,
      });
    }
  };

  if (profileLoading) {
    return (
      <div className="flex-1 overflow-hidden">
        <header className="sticky top-0 z-10 bg-background border-b px-6 py-4">
          <Skeleton className="h-8 w-48" />
        </header>
        <main className="p-6">
          <div className="max-w-3xl space-y-6">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="sticky top-0 z-10 bg-background border-b px-6 py-4 shrink-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
              <User className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold" data-testid="text-page-title">Profile Settings</h1>
              <p className="text-sm text-muted-foreground">
                Customize your content preferences
              </p>
            </div>
          </div>
          <Button 
            onClick={handleSave} 
            disabled={updateMutation.isPending}
            data-testid="button-save-profile"
          >
            <Save className="w-4 h-4 mr-2" />
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </header>
      
      <main className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-3xl space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tag className="w-5 h-5" />
                Focus Area
              </CardTitle>
              <CardDescription>
                Describe what you want to be known for in your industry
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={focusDescription}
                onChange={(e) => setFocusDescription(e.target.value)}
                placeholder="e.g., I focus on programmatic advertising innovation and the future of cookie-less targeting..."
                className="min-h-[100px]"
                data-testid="input-focus-description"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Newspaper className="w-5 h-5" />
                Publications
              </CardTitle>
              <CardDescription>
                Industry publications you follow for insights
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {publications.map((pub) => (
                  <Badge key={pub} variant="secondary" className="gap-1">
                    {pub}
                    <button
                      onClick={() => removeItem(publications, setPublications, pub)}
                      className="ml-1 hover:text-destructive"
                      data-testid={`button-remove-publication-${pub}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
                {publications.length === 0 && (
                  <p className="text-sm text-muted-foreground">No publications added yet</p>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newPublication}
                  onChange={(e) => setNewPublication(e.target.value)}
                  placeholder="Add a publication..."
                  onKeyDown={(e) => e.key === "Enter" && addItem(publications, setPublications, newPublication, setNewPublication)}
                  data-testid="input-new-publication"
                />
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => addItem(publications, setPublications, newPublication, setNewPublication)}
                  data-testid="button-add-publication"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tag className="w-5 h-5" />
                Keywords
              </CardTitle>
              <CardDescription>
                Topics and keywords that match your expertise
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {keywords.map((keyword) => (
                  <Badge key={keyword} variant="secondary" className="gap-1">
                    {keyword}
                    <button
                      onClick={() => removeItem(keywords, setKeywords, keyword)}
                      className="ml-1 hover:text-destructive"
                      data-testid={`button-remove-keyword-${keyword}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
                {keywords.length === 0 && (
                  <p className="text-sm text-muted-foreground">No keywords added yet</p>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  placeholder="Add a keyword..."
                  onKeyDown={(e) => e.key === "Enter" && addItem(keywords, setKeywords, newKeyword, setNewKeyword)}
                  data-testid="input-new-keyword"
                />
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => addItem(keywords, setKeywords, newKeyword, setNewKeyword)}
                  data-testid="button-add-keyword"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Influencers
              </CardTitle>
              <CardDescription>
                Industry leaders whose insights you value
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {influencers.map((influencer) => (
                  <Badge key={influencer} variant="secondary" className="gap-1">
                    {influencer}
                    <button
                      onClick={() => removeItem(influencers, setInfluencers, influencer)}
                      className="ml-1 hover:text-destructive"
                      data-testid={`button-remove-influencer-${influencer}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
                {influencers.length === 0 && (
                  <p className="text-sm text-muted-foreground">No influencers added yet</p>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newInfluencer}
                  onChange={(e) => setNewInfluencer(e.target.value)}
                  placeholder="Add an influencer..."
                  onKeyDown={(e) => e.key === "Enter" && addItem(influencers, setInfluencers, newInfluencer, setNewInfluencer)}
                  data-testid="input-new-influencer"
                />
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => addItem(influencers, setInfluencers, newInfluencer, setNewInfluencer)}
                  data-testid="button-add-influencer"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                Companies
              </CardTitle>
              <CardDescription>
                Companies you want to track for news and updates
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {companies.map((company) => (
                  <Badge key={company} variant="secondary" className="gap-1">
                    {company}
                    <button
                      onClick={() => removeItem(companies, setCompanies, company)}
                      className="ml-1 hover:text-destructive"
                      data-testid={`button-remove-company-${company}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
                {companies.length === 0 && (
                  <p className="text-sm text-muted-foreground">No companies added yet</p>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  placeholder="Add a company..."
                  onKeyDown={(e) => e.key === "Enter" && addItem(companies, setCompanies, newCompany, setNewCompany)}
                  data-testid="input-new-company"
                />
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => addItem(companies, setCompanies, newCompany, setNewCompany)}
                  data-testid="button-add-company"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {aiKeywords.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  AI-Detected Keywords
                </CardTitle>
                <CardDescription>
                  Keywords extracted from your inbox content. Click to add to your profile.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {aiKeywords.map((keyword) => (
                    <Badge 
                      key={keyword} 
                      variant="outline" 
                      className={`cursor-pointer hover-elevate ${keywords.includes(keyword) ? 'bg-primary/10 border-primary' : ''}`}
                      onClick={() => addAiKeywordToProfile(keyword)}
                      data-testid={`badge-ai-keyword-${keyword}`}
                    >
                      <Sparkles className="w-3 h-3 mr-1 text-primary" />
                      {keyword}
                      {keywords.includes(keyword) && (
                        <span className="ml-1 text-xs text-primary">(added)</span>
                      )}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
