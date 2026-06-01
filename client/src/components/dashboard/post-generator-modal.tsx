import { useState, useEffect } from "react";
import { Linkedin, RefreshCw, Send, Save, Copy, Check, ExternalLink, X, Plus, Hash } from "lucide-react";
import { SiX } from "react-icons/si";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { InboxItem } from "@shared/schema";

interface PostGeneratorModalProps {
  item: InboxItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSaveDraft: (platform: string, tone: string, content: string) => void;
  onPost: (platform: string, tone: string, content: string) => void;
}

const tones = [
  { value: "professional", label: "Thought Leader", description: "Visionary, forward-thinking" },
  { value: "authoritative", label: "Industry Insider", description: "Expert, decisive voice" },
  { value: "contrarian", label: "Provocateur", description: "Challenge the status quo" },
  { value: "ai-recommended", label: "AI Picks", description: "AI-optimised for engagement" },
];

function buildHashtags(matchedKeywords?: string[] | null): string[] {
  const tags: string[] = ["#thesocialpundit"];
  if (matchedKeywords && matchedKeywords.length > 0) {
    matchedKeywords.slice(0, 3).forEach((keyword) => {
      const clean = keyword.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "");
      if (clean.length > 1) {
        const tag = "#" + clean;
        if (!tags.includes(tag)) tags.push(tag);
      }
    });
  }
  return tags;
}

export function PostGeneratorModal({ item, isOpen, onClose, onSaveDraft, onPost }: PostGeneratorModalProps) {
  const [platform, setPlatform] = useState<string>("linkedin");
  const [tone, setTone] = useState<string>("professional");
  const [content, setContent] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hashtags, setHashtags] = useState<string[]>(["#thesocialpundit"]);
  const [newHashtag, setNewHashtag] = useState("");
  const { toast } = useToast();

  const generateAIContent = async (selectedPlatform: string, selectedTone: string) => {
    if (!item) return;
    setIsGenerating(true);
    try {
      const response = await apiRequest("POST", "/api/ai/generate-post", {
        headline: item.headline,
        summary: item.summary || "",
        source: item.source,
        articleUrl: item.articleUrl,
        platform: selectedPlatform,
        tone: selectedTone,
      });
      const data = await response.json();
      setContent(data.content || "");
    } catch (error) {
      console.error("Error generating AI content:", error);
      setContent("");
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    if (isOpen && item) {
      generateAIContent(platform, tone);
      setHashtags(buildHashtags(item.matchedKeywords));
      setCopied(false);
    }
  }, [isOpen, item?.id]);

  const handleToneChange = (newTone: string) => {
    if (newTone) {
      setTone(newTone);
      generateAIContent(platform, newTone);
    }
  };

  const handlePlatformChange = (newPlatform: string) => {
    if (newPlatform) {
      setPlatform(newPlatform);
      generateAIContent(newPlatform, tone);
    }
  };

  const handleRegenerate = () => {
    generateAIContent(platform, tone);
  };

  const removeHashtag = (tag: string) => {
    setHashtags((prev) => prev.filter((t) => t !== tag));
  };

  const addHashtag = () => {
    const trimmed = newHashtag.trim().replace(/\s+/g, "");
    if (!trimmed) return;
    const tag = trimmed.startsWith("#") ? trimmed : "#" + trimmed;
    if (!hashtags.includes(tag)) {
      setHashtags((prev) => [...prev, tag]);
    }
    setNewHashtag("");
  };

  const getFullContent = () => {
    const tagLine = hashtags.join(" ");
    return tagLine ? `${content}\n\n${tagLine}` : content;
  };

  const handleCopyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(getFullContent());
      setCopied(true);
      toast({
        title: "Copied to clipboard",
        description: "Post content and hashtags are ready to paste.",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Copy failed",
        description: "Could not copy to clipboard. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handlePostNow = async () => {
    const full = getFullContent();
    try {
      await navigator.clipboard.writeText(full);
    } catch {
      // clipboard failure non-fatal — proceed to open platform
    }

    if (platform === "linkedin") {
      const linkedInUrl = item?.articleUrl
        ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(item.articleUrl)}`
        : "https://www.linkedin.com/feed/?shareActive=true";
      window.open(linkedInUrl, "_blank");
      toast({
        title: "Opening LinkedIn",
        description: "Your post is copied — paste it into the LinkedIn composer and hit Post.",
      });
    } else {
      const twitterText = full.substring(0, 280);
      const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(twitterText)}`;
      window.open(twitterUrl, "_blank");
      toast({
        title: "Opening Twitter/X",
        description: "Your post is pre-filled and ready to send.",
      });
    }

    onPost(platform, tone, full);
  };

  const characterLimit = platform === "twitter" ? 280 : 3000;
  const fullContent = getFullContent();
  const characterCount = fullContent.length;

  if (!item) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl p-0 gap-0 overflow-hidden max-h-[90vh]">
        <div className="flex h-full">
          <div className="w-72 shrink-0 border-r bg-muted/30 p-6 flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold">Post Options</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                data-testid="button-close-modal"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-6 flex-1">
              <div className="space-y-3">
                <Label className="text-sm font-medium">Platform</Label>
                <div className="flex flex-col gap-2">
                  <Button
                    variant={platform === "linkedin" ? "default" : "outline"}
                    className="justify-start w-full"
                    onClick={() => handlePlatformChange("linkedin")}
                    data-testid="toggle-linkedin"
                  >
                    <Linkedin className="w-4 h-4 mr-2" />
                    LinkedIn
                  </Button>
                  <Button
                    variant={platform === "twitter" ? "default" : "outline"}
                    className="justify-start w-full"
                    onClick={() => handlePlatformChange("twitter")}
                    data-testid="toggle-twitter"
                  >
                    <SiX className="w-4 h-4 mr-2" />
                    Twitter/X
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-sm font-medium">Tone</Label>
                <div className="flex flex-col gap-2">
                  {tones.map((t) => (
                    <Button
                      key={t.value}
                      variant={tone === t.value ? "default" : "outline"}
                      className="justify-start w-full"
                      onClick={() => handleToneChange(t.value)}
                      data-testid={`toggle-tone-${t.value}`}
                    >
                      {t.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t space-y-2">
              <Button
                variant="secondary"
                className="w-full justify-center"
                onClick={() => onSaveDraft(platform, tone, fullContent)}
                data-testid="button-save-draft"
              >
                <Save className="w-4 h-4 mr-2" />
                Save Draft
              </Button>
              <Button
                className="w-full justify-center"
                onClick={handlePostNow}
                disabled={characterCount > characterLimit || isGenerating}
                data-testid="button-post-now"
              >
                <Send className="w-4 h-4 mr-2" />
                Post Now
              </Button>
            </div>
          </div>

          <div className="flex-1 p-6 flex flex-col min-w-0 overflow-y-auto">
            <div className="mb-4">
              <h3 className="text-lg font-semibold mb-1">Your Post</h3>
              <p className="text-sm text-muted-foreground line-clamp-2">
                Based on: {item.headline}
              </p>
              {item.articleUrl && (
                <a
                  href={item.articleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                  data-testid="link-view-article"
                >
                  View original article
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRegenerate}
                    disabled={isGenerating}
                    data-testid="button-regenerate"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isGenerating ? "animate-spin" : ""}`} />
                    Regenerate
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyToClipboard}
                    data-testid="button-copy-content"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 mr-1.5 text-green-500" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 mr-1.5" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground">
                  {characterCount} / {characterLimit}
                  {characterCount > characterLimit && (
                    <span className="text-destructive ml-2">Exceeds limit</span>
                  )}
                </div>
              </div>

              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="flex-1 min-h-[300px] resize-none text-base leading-relaxed"
                placeholder="Your post content..."
                data-testid="textarea-post-content"
              />

              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Hashtags</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {hashtags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="gap-1 pr-1 text-xs"
                      data-testid={`badge-hashtag-${tag}`}
                    >
                      {tag}
                      <button
                        onClick={() => removeHashtag(tag)}
                        className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                        data-testid={`button-remove-hashtag-${tag}`}
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </Badge>
                  ))}
                  <div className="flex items-center gap-1">
                    <Input
                      value={newHashtag}
                      onChange={(e) => setNewHashtag(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addHashtag()}
                      placeholder="Add hashtag"
                      className="h-6 text-xs w-28 px-2"
                      data-testid="input-new-hashtag"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={addHashtag}
                      data-testid="button-add-hashtag"
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Hashtags are appended when you copy or post.
                </p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
