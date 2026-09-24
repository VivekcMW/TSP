import { useState, useEffect, useMemo, useCallback, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ExternalLink, Link2, User, Sparkles, Save, Plus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useSettingsDraft } from "@/components/settings/use-settings-draft";
import type { SettingsSaveAction } from "@/components/settings/settings-shell";
import { PageHeader } from "@/components/dashboard/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { SourcesManagerContent } from "@/components/dashboard/sources-manager";
import { getIndustryData } from "@/lib/industry-data";
import type { UserProfile, InboxItem, ProfileSocialLink } from "@shared/schema";
import { reconcileKeywords } from "@shared/profile-preferences";
import { getSearchEdition, SEARCH_EDITIONS } from "@shared/search-editions";
import { publicationCandidatesSchema, reconcilePublicationCandidates, selectedPublicationCandidates, type PublicationCandidate } from "@shared/publication-preferences";
import { PublicationSourceFeedback } from "@/components/settings/publication-source-feedback";
import { parsePublicationCandidate } from "@/lib/publication-candidates";

// Helper to extract keyword strings from weighted keywords
function keywordStrings(keywords: (string | { keyword: string; weight?: number })[]): string[] {
  return keywords.map(kw => typeof kw === 'string' ? kw : kw.keyword);
}

function contentValues(profile?: UserProfile & { publicationCandidates?: PublicationCandidate[] }) {
  return {
    searchEdition: getSearchEdition(profile?.searchEdition).id,
    focusDescription: profile?.focusDescription ?? "",
    publications: profile?.publications ?? [],
    publicationCandidates: reconcilePublicationCandidates(profile?.publications ?? [], profile?.publicationCandidates ?? []),
    // Keep this in the draft snapshot: a refetch must not erase an explicit clear.
    hadPublicationCandidates: Boolean(profile?.publicationCandidates?.length),
    keywords: keywordStrings(profile?.keywords ?? []),
    influencers: profile?.influencers ?? [],
    companies: profile?.companies ?? [],
  };
}

const socialLinkPlatforms = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "twitter", label: "X / Twitter" },
  { value: "github", label: "GitHub" },
  { value: "instagram", label: "Instagram" },
  { value: "youtube", label: "YouTube" },
  { value: "website", label: "Personal website" },
  { value: "portfolio", label: "Portfolio" },
  { value: "other", label: "Other" },
];

interface ProfileSettingsPageProps {
  embedded?: boolean;
  onSaveActionChange?: (action: SettingsSaveAction | null) => void;
}

export default function ProfileSettingsPage({ embedded = false, onSaveActionChange }: Readonly<ProfileSettingsPageProps>) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const Body = embedded ? "div" : "main";
  
  const { data: profile, isLoading: profileLoading, isError: profileError, refetch } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
  });
  const { data: currentUser } = useQuery<{ industry?: string; country?: string }>({
    queryKey: ["/api/me"],
  });

  const { data: inboxItems } = useQuery<InboxItem[]>({
    queryKey: ["/api/inbox"],
  });
  const { data: socialLinks = [], isLoading: socialLinksLoading } = useQuery<ProfileSocialLink[]>({ queryKey: ["/api/profile/social-links"] });

  const { draft, setDraft, dirty, acknowledge } = useSettingsDraft(contentValues(profile));
  const { searchEdition, focusDescription, publications, publicationCandidates, keywords, influencers, companies } = draft;
  const setFocusDescription = (value: string) => setDraft((current) => ({ ...current, focusDescription: value }));
  const setPublications = (value: string[]) => setDraft((current) => ({
    ...current, publications: value,
    publicationCandidates: reconcilePublicationCandidates(value, current.publicationCandidates),
  }));
  const setPublicationUrl = (name: string, url: string) => setDraft((current) => {
    const candidates = current.publicationCandidates;
    const matches = (item: PublicationCandidate) => item.name.toLowerCase() === name.toLowerCase();
    let next = candidates.filter(item => !matches(item));
    if (url.trim()) {
      next = candidates.some(matches)
        ? candidates.map(item => matches(item) ? { name: item.name, url } : item)
        : [...candidates, { name, url }];
    }
    return { ...current, publicationCandidates: next };
  });
  const setKeywords = (value: string[]) => setDraft((current) => ({ ...current, keywords: value }));
  const setInfluencers = (value: string[]) => setDraft((current) => ({ ...current, influencers: value }));
  const setCompanies = (value: string[]) => setDraft((current) => ({ ...current, companies: value }));
  const [newLinkPlatform, setNewLinkPlatform] = useState("linkedin");
  const [newLinkLabel, setNewLinkLabel] = useState("LinkedIn");
  const [newLinkUrl, setNewLinkUrl] = useState("");

  const aiKeywords = inboxItems?.flatMap(item => item.matchedKeywords || [])
    .filter((keyword, index, self) => self.indexOf(keyword) === index) || [];
  const industryData = useMemo(
    () => getIndustryData(currentUser?.industry, currentUser?.country),
    [currentUser?.industry, currentUser?.country],
  );
  const publicationOptions = industryData.publications.map((value) => ({ value }));
  const keywordOptions = [...industryData.keywords, ...aiKeywords].map((value) => ({ value }));
  const influencerOptions = industryData.influencers.map((value) => ({ value }));
  const companyOptions = industryData.companies.map((value) => ({ value }));

  const updateMutation = useMutation({
    mutationFn: async (data: typeof draft): Promise<UserProfile> => {
      // Label-only edits must not reset saved weights or categories.
      const { publicationCandidates: candidates, hadPublicationCandidates, ...values } = data;
      const selectedCandidates = publicationCandidatesSchema.parse(selectedPublicationCandidates(data.publications, candidates));
      const payload = {
        ...values,
        ...(hadPublicationCandidates || selectedCandidates.length ? { publicationCandidates: selectedCandidates } : {}),
        keywords: reconcileKeywords(data.keywords, profile?.keywords ?? []),
      };
      return (await apiRequest("PATCH", "/api/profile", payload)).json();
    },
    onSuccess: (saved, submitted) => {
      acknowledge(submitted, contentValues(saved));
      queryClient.setQueryData(["/api/profile"], saved);
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sources/publications"] });
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

  const addLinkMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/profile/social-links", { platform: newLinkPlatform, label: newLinkLabel, url: newLinkUrl })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/profile/social-links"] }); setNewLinkUrl(""); toast({ title: "Social link added", description: "Your public profile link is saved." }); },
    onError: (error: Error) => toast({ title: "Could not add link", description: error.message, variant: "destructive" }),
  });
  const deleteLinkMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/profile/social-links/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/profile/social-links"] }); toast({ title: "Social link removed" }); },
    onError: (error: Error) => toast({ title: "Could not remove link", description: error.message, variant: "destructive" }),
  });
  const reorderLinksMutation = useMutation({
    mutationFn: async (ids: string[]) => apiRequest("PUT", "/api/profile/social-links/reorder", { ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/profile/social-links"] }),
  });

  const { mutate: saveContent, isPending: savePending } = updateMutation;
  const validPublicationUrls = publicationCandidates.length <= 20 && publicationCandidates.every(item => Boolean(parsePublicationCandidate(item)));
  const saveDisabled = !dirty || !profile || profileError || profileLoading || !validPublicationUrls;
  const handleSave = useCallback(() => {
    if (!saveDisabled && !savePending) saveContent(draft);
  }, [draft, saveContent, saveDisabled, savePending]);

  useEffect(() => {
    if (!embedded || !onSaveActionChange) return;
    onSaveActionChange({ onSave: handleSave, isPending: savePending, disabled: saveDisabled });
    return () => onSaveActionChange(null);
  }, [embedded, handleSave, onSaveActionChange, savePending, saveDisabled]);

  function moveLink(index: number, direction: -1 | 1) {
    const ids = socialLinks.map((link) => link.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorderLinksMutation.mutate(ids);
  }

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

  const handleLinkPlatformChange = (value: string) => {
    setNewLinkPlatform(value);
    setNewLinkLabel(socialLinkPlatforms.find((platform) => platform.value === value)?.label ?? "Other");
  };

  let socialLinksContent: ReactNode;
  if (socialLinksLoading) {
    socialLinksContent = <Skeleton className="h-12 w-full" />;
  } else if (socialLinks.length > 0) {
    socialLinksContent = (
      <div className="space-y-2">
        {socialLinks.map((link, index) => (
          <div key={link.id} className="flex flex-wrap items-center gap-3 rounded-[4px] border p-3" data-testid={`social-link-${link.platform}`}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] bg-secondary/15"><Link2 className="h-4 w-4 text-secondary" /></div>
            <div className="min-w-0 flex-1"><p className="text-sm font-medium">{link.label}</p><a href={link.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-muted-foreground hover:text-primary">{link.url}</a></div>
            <div className="flex shrink-0 items-center gap-1">
              <Button type="button" variant="ghost" size="icon" className="h-11 w-11" disabled={index === 0 || reorderLinksMutation.isPending} onClick={() => moveLink(index, -1)} aria-label={`Move ${link.label} up`}><ArrowUp className="h-3.5 w-3.5" /></Button>
              <Button type="button" variant="ghost" size="icon" className="h-11 w-11" disabled={index === socialLinks.length - 1 || reorderLinksMutation.isPending} onClick={() => moveLink(index, 1)} aria-label={`Move ${link.label} down`}><ArrowDown className="h-3.5 w-3.5" /></Button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={deleteLinkMutation.isPending} onClick={() => deleteLinkMutation.mutate(link.id)} aria-label={`Remove ${link.label}`}><X className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        ))}
      </div>
    );
  } else {
    socialLinksContent = <p className="rounded-[4px] border border-dashed p-4 text-sm text-muted-foreground">No public links added yet.</p>;
  }

  if (profileLoading) {
    if (embedded) return <div className="space-y-6"><Skeleton className="h-48 w-full" /><Skeleton className="h-48 w-full" /></div>;
    return (
      <div className="flex-1 overflow-hidden">
        <header className="sticky top-0 z-10 bg-background border-b px-6 py-4">
          <Skeleton className="h-8 w-48" />
        </header>
        <main className="p-4 sm:p-6">
          <div className="mx-auto w-full max-w-5xl space-y-6">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </main>
      </div>
    );
  }

  if (profileError || !profile) return <div role="alert" className="p-4">Content preferences could not be loaded. <Button className="min-h-11" variant="outline" onClick={() => refetch()}>Retry</Button></div>;

  return (
    <>
      {!embedded && <PageHeader
        icon={User}
        title="Profile Settings"
        subtitle="Customize your content preferences"
        actions={<Button className="min-h-11" onClick={handleSave} disabled={savePending || saveDisabled} data-testid="button-save-profile"><Save className="w-4 h-4 mr-2" />{savePending ? "Saving..." : "Save Changes"}</Button>}
      />}
      
      <Body className={embedded ? "" : "flex-1 p-4 sm:p-6 overflow-y-auto"}>
        <fieldset disabled={savePending} className="mx-auto w-full min-w-0 max-w-5xl space-y-6 [&_button]:min-h-11 [&_button]:min-w-11 [&_input]:min-h-11">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle><label htmlFor="focus-description">Voice &amp; focus</label></CardTitle>
                <CardDescription>
                  Describe what you want to be known for in your industry
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <Textarea
                id="focus-description"
                maxLength={500}
                value={focusDescription}
                onChange={(e) => setFocusDescription(e.target.value)}
                placeholder="e.g., I help SaaS companies scale their go-to-market strategy and build product-led growth loops..."
                className="min-h-[100px]"
                data-testid="input-focus-description"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle><label htmlFor="search-edition">Search language &amp; region</label></CardTitle>
              <CardDescription id="search-edition-description">
                Choose a provider edition preference for news search. This is not a strict language or location filter and does not translate your queries.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select value={searchEdition} onValueChange={(value) => setDraft((current) => ({ ...current, searchEdition: getSearchEdition(value).id }))} disabled={savePending}>
                <SelectTrigger id="search-edition" aria-describedby="search-edition-description"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEARCH_EDITIONS.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card data-testid="card-profile-social-links">
            <CardHeader>
              <CardTitle>Social profiles</CardTitle>
              <CardDescription>Links people can visit when they want to learn more about your work.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {socialLinksContent}
              <div className="grid gap-2 md:grid-cols-[180px_1fr_1.5fr_auto]">
                <Select value={newLinkPlatform} onValueChange={handleLinkPlatformChange}><SelectTrigger aria-label="Social platform"><SelectValue /></SelectTrigger><SelectContent>{socialLinkPlatforms.filter((platform) => !socialLinks.some((link) => link.platform === platform.value)).map((platform) => <SelectItem key={platform.value} value={platform.value}>{platform.label}</SelectItem>)}</SelectContent></Select>
                <Input value={newLinkLabel} onChange={(event) => setNewLinkLabel(event.target.value)} placeholder="Link label" aria-label="Social link label" />
                <Input value={newLinkUrl} onChange={(event) => setNewLinkUrl(event.target.value)} placeholder="https://…" type="url" aria-label="Social link URL" />
                <Button type="button" onClick={() => addLinkMutation.mutate()} disabled={!newLinkUrl.trim() || !newLinkLabel.trim() || addLinkMutation.isPending} aria-label="Add social link"><Plus className="mr-2 h-4 w-4" />Add</Button>
              </div>
              <p className="flex items-center gap-2 text-xs text-muted-foreground"><ExternalLink className="h-3.5 w-3.5" />Only public URLs are stored here. Connected publishing credentials remain protected in Connections.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Publications</CardTitle>
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
                      type="button"
                      aria-label={`Remove publication ${pub}`}
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
              <SearchableMultiSelect
                options={publicationOptions}
                selected={publications}
                onChange={setPublications}
                placeholder="Search or select publications..."
                searchPlaceholder="Search publications..."
                aria-label="Search and select publications"
                maxItems={20}
              />
              <p className="text-xs text-muted-foreground">Choose from industry suggestions or add your own publication.</p>
              <p className="text-xs text-muted-foreground">Changing or removing a URL pauses its auto-added source when no other selected publication uses it. Manually added sources stay unchanged; manage them in Custom Sources.</p>
              {publications.map((name, index) => {
                const candidate = publicationCandidates.find(item => item.name.toLowerCase() === name.toLowerCase());
                const invalid = candidate && !parsePublicationCandidate(candidate);
                const inputId = `publication-url-${index}`;
                let hint = candidate ? "Unverified URL" : "URL needed";
                if (invalid) hint = "Use an HTTP(S) URL without credentials, up to 2048 characters.";
                return <div key={name} className="space-y-1">
                  <label htmlFor={inputId} className="text-sm font-medium">URL for {name}</label>
                  <Input id={inputId} type="url" maxLength={2048} placeholder="https://…" value={candidate?.url ?? ""}
                    onChange={(event) => setPublicationUrl(name, event.target.value)}
                    aria-invalid={Boolean(invalid)} aria-describedby={`${inputId}-hint`} />
                  <p id={`${inputId}-hint`} className={`text-xs ${invalid ? "text-destructive" : "text-muted-foreground"}`}>
                    {hint}
                  </p>
                </div>;
              })}
              <PublicationSourceFeedback />
            </CardContent>
          </Card>

          <Card data-testid="card-custom-sources">
            <CardHeader>
              <CardTitle>Custom Sources</CardTitle>
              <CardDescription>
                Add a public blog, publication, or site. Discover reads your active sources, selected publication URLs after a successful check, and live search on your keywords, companies and influencers.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SourcesManagerContent />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Keywords</CardTitle>
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
                      type="button"
                      aria-label={`Remove keyword ${keyword}`}
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
              <SearchableMultiSelect
                options={keywordOptions}
                selected={keywords}
                onChange={setKeywords}
                placeholder="Search or select keywords..."
                searchPlaceholder="Search keywords..."
                aria-label="Search and select keywords"
                maxItems={20}
              />
              <p className="text-xs text-muted-foreground">Suggestions are based on your industry and detected inbox topics.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Influencers</CardTitle>
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
                      type="button"
                      aria-label={`Remove influencer ${influencer}`}
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
              <SearchableMultiSelect
                options={influencerOptions}
                selected={influencers}
                onChange={setInfluencers}
                placeholder="Search or select influencers..."
                searchPlaceholder="Search influencers..."
                aria-label="Search and select influencers"
                maxItems={20}
              />
              <p className="text-xs text-muted-foreground">Relevant industry and country-based leaders are shown first.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Companies</CardTitle>
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
                      type="button"
                      aria-label={`Remove company ${company}`}
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
              <SearchableMultiSelect
                options={companyOptions}
                selected={companies}
                onChange={setCompanies}
                placeholder="Search or select companies..."
                searchPlaceholder="Search companies..."
                aria-label="Search and select companies"
                maxItems={20}
              />
            </CardContent>
          </Card>

          {aiKeywords.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>AI-Detected Keywords</CardTitle>
                <CardDescription>
                  Keywords extracted from your inbox content. Click to add to your profile.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {aiKeywords.map((keyword) => (
                    <button
                      type="button"
                      key={keyword} 
                      aria-label={`Add keyword ${keyword}`}
                      disabled={keywords.includes(keyword) || keywords.length >= 20}
                      className={`inline-flex items-center rounded-md border px-3 text-sm hover-elevate ${keywords.includes(keyword) ? 'bg-primary/10 border-primary' : ''}`}
                      onClick={() => addAiKeywordToProfile(keyword)}
                      data-testid={`badge-ai-keyword-${keyword}`}
                    >
                      <Sparkles className="w-3 h-3 mr-1 text-primary" />
                      {keyword}
                      {keywords.includes(keyword) && (
                        <span className="ml-1 text-xs text-primary">(added)</span>
                      )}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </fieldset>
      </Body>
    </>
  );
}
