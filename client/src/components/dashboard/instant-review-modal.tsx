import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link2, Loader2, Copy, Check, Linkedin, Send, X } from "lucide-react";
import { SiX } from "react-icons/si";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PLATFORMS, getPlatformMeta } from "@/lib/platforms";

interface InstantReviewResult {
  article: {
    title: string;
    source: string;
    url: string;
    domain: string;
    content: string;
  };
  posts: Record<string, Record<typeof TONALITIES[number]["key"], string>>;
}

interface InstantReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TONALITIES = [
  { key: "thoughtLeader", toneValue: "professional", label: "Thought Leader", description: "Visionary and forward-thinking" },
  { key: "industryInsider", toneValue: "authoritative", label: "Industry Insider", description: "Behind-the-scenes perspective" },
  { key: "provocateur", toneValue: "contrarian", label: "Provocateur", description: "Bold contrarian stance" },
  { key: "dataDriven", toneValue: "ai-recommended", label: "Data-Driven", description: "Evidence-based analysis" },
] as const;

const BRAND_HASHTAG = "#thesocialpundit";

function buildDefaultHashtags(source: string): string[] {
  const tags: string[] = [BRAND_HASHTAG];
  const sourceTag = "#" + source.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "");
  if (sourceTag.length > 1 && sourceTag !== BRAND_HASHTAG) {
    tags.push(sourceTag);
  }
  return tags;
}

function PostCard({
  content,
  tonality,
  platform,
  articleUrl,
  hashtags,
  onSaveDraft,
  isSaving,
}: {
  content: string;
  tonality: typeof TONALITIES[number];
  platform: string;
  articleUrl: string;
  hashtags: string[];
  onSaveDraft: () => void;
  isSaving: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [localHashtags, setLocalHashtags] = useState<string[]>(hashtags);
  const { toast } = useToast();

  const getFullContent = () => {
    const tagLine = localHashtags.join(" ");
    return tagLine ? `${content}\n\n${tagLine}` : content;
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(getFullContent());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePostNow = async () => {
    const full = getFullContent();
    try {
      await navigator.clipboard.writeText(full);
    } catch {
      // non-fatal
    }

    const meta = getPlatformMeta(platform);
    window.open(meta.composeUrl(full, articleUrl), "_blank");
    toast({ title: `Opening ${meta.label}`, description: "Your post is copied and ready to paste into the composer." });
  };

  const removeHashtag = (tag: string) => {
    setLocalHashtags((prev) => prev.filter((t) => t !== tag));
  };

  return (
    <Card className="mb-4">
      <CardContent className="pt-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {tonality.label}
            </Badge>
            <span className="text-xs text-muted-foreground">{tonality.description}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCopy}
              data-testid={`button-copy-${platform}-${tonality.key}`}
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handlePostNow}
              data-testid={`button-post-${platform}-${tonality.key}`}
            >
              {(() => { const Icon = getPlatformMeta(platform).icon; return <Icon className="w-3.5 h-3.5 mr-1.5" />; })()}
              Post Now
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={onSaveDraft}
              disabled={isSaving}
              data-testid={`button-save-${platform}-${tonality.key}`}
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Draft"}
            </Button>
          </div>
        </div>

        <div className="bg-muted/50 rounded-md p-3">
          <p className="text-sm whitespace-pre-wrap">{content}</p>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {localHashtags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="gap-1 pr-1 text-xs"
              data-testid={`badge-hashtag-${platform}-${tonality.key}-${tag}`}
            >
              {tag}
              <button
                onClick={() => removeHashtag(tag)}
                className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </Badge>
          ))}
        </div>

        {platform === "twitter" && (
          <div className="mt-2 text-xs text-muted-foreground text-right">
            {getFullContent().length}/280 characters
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function InstantReviewModal({ isOpen, onClose }: InstantReviewModalProps) {
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<InstantReviewResult | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(["linkedin", "twitter"]);
  const [selectedPlatform, setSelectedPlatform] = useState("linkedin");
  const [savingDraft, setSavingDraft] = useState<string | null>(null);

  const reviewMutation = useMutation({
    mutationFn: async (articleUrl: string) => {
      const endpoint = selectedPlatforms.length === 2 && selectedPlatforms.includes("linkedin") && selectedPlatforms.includes("twitter") ? "/api/instant-review" : "/api/instant-review/selected";
      const res = await apiRequest("POST", endpoint, { url: articleUrl, selectedPlatforms });
      return res.json() as Promise<InstantReviewResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      toast({
        title: "Posts generated",
        description: `${data.article.source} has been added to your publications.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to generate",
        description: error.message || "Could not process the article. Please try a different URL.",
        variant: "destructive",
      });
    },
  });

  const saveDraftMutation = useMutation({
    mutationFn: async (data: { platform: string; tone: string; content: string }) => {
      const res = await apiRequest("POST", "/api/drafts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drafts"] });
      toast({
        title: "Draft saved",
        description: "Find it in your Drafts tab.",
      });
      setSavingDraft(null);
    },
    onError: () => {
      toast({
        title: "Failed to save draft",
        description: "Please try again.",
        variant: "destructive",
      });
      setSavingDraft(null);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setResult(null);
    reviewMutation.mutate(url.trim());
  };

  const handleSaveDraft = (platform: string, tonalityKey: string, toneValue: string, content: string) => {
    setSavingDraft(`${platform}-${tonalityKey}`);
    saveDraftMutation.mutate({ platform, tone: toneValue, content });
  };

  const handleClose = () => {
    setUrl("");
    setResult(null);
    onClose();
  };

  const currentPosts = result?.posts[selectedPlatform];
  const defaultHashtags = result ? buildDefaultHashtags(result.article.source) : [BRAND_HASHTAG];

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col min-h-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5" />
            Instant Review
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex gap-2 mb-4">
          <Input
            placeholder="Paste article URL here..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="flex-1"
            data-testid="input-article-url"
          />
          <Button
            type="submit"
            disabled={reviewMutation.isPending || !url.trim()}
            data-testid="button-generate-review"
          >
            {reviewMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              "Generate Posts"
            )}
          </Button>
        </form>
        <div className="mb-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Choose up to 4 platforms. Four tones are generated for each selected platform.</p>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((platform) => {
              const selected = selectedPlatforms.includes(platform.value);
              const Icon = platform.icon;
              return <Button key={platform.value} type="button" size="sm" variant={selected ? "default" : "outline"} onClick={() => setSelectedPlatforms((current) => selected ? current.filter((value) => value !== platform.value) : current.length < 4 ? [...current, platform.value] : current)} disabled={!selected && selectedPlatforms.length >= 4} className="gap-1.5"><Icon className="h-3.5 w-3.5" />{platform.label}</Button>;
            })}
          </div>
        </div>

        {reviewMutation.isPending && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
              <Loader2 className="w-5 h-5 animate-spin" />
              <div>
                <p className="font-medium">Analysing article...</p>
                <p className="text-sm text-muted-foreground">
                  Generating {selectedPlatforms.length * 4} posts across {selectedPlatforms.length} selected platform{selectedPlatforms.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <div className="grid gap-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          </div>
        )}

        {result && (
          <>
            <div className="p-3 bg-muted/50 rounded-lg mb-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm truncate">{result.article.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Source: {result.article.source}
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0">
                  Added to publications
                </Badge>
              </div>
            </div>

            <Tabs
              value={selectedPlatform}
              onValueChange={setSelectedPlatform}
              className="flex-1 flex flex-col min-h-0"
            >
              <TabsList className="w-full justify-start">
                {Object.keys(result.posts).map((platform) => { const meta = getPlatformMeta(platform); const Icon = meta.icon; return <TabsTrigger key={platform} value={platform} className="flex items-center gap-2"><Icon className="w-4 h-4" />{meta.label}</TabsTrigger>; })}
              </TabsList>

              <ScrollArea className="flex-1 min-h-0 mt-4">
                <TabsContent value={selectedPlatform} className="mt-0 pb-4">
                  {TONALITIES.map((tonality) => (
                    <PostCard
                      key={tonality.key}
                      content={currentPosts?.[tonality.key] || ""}
                      tonality={tonality}
                      platform={selectedPlatform}
                      articleUrl={result.article.url}
                      hashtags={[...defaultHashtags]}
                      onSaveDraft={() => handleSaveDraft(selectedPlatform, tonality.key, tonality.toneValue, currentPosts?.[tonality.key] || "")}
                      isSaving={savingDraft === `${selectedPlatform}-${tonality.key}`}
                    />
                  ))}
                </TabsContent>
              </ScrollArea>
            </Tabs>
          </>
        )}

        {!reviewMutation.isPending && !result && (
          <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Link2 className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">Paste any article URL</h3>
            <p className="text-muted-foreground max-w-md">
              Choose one to four platforms. We'll create four distinct tonalities for each,
              and automatically add the publication to your profile.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
