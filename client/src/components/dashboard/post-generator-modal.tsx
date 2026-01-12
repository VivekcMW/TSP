import { useState, useEffect } from "react";
import { Linkedin, RefreshCw, Send, Save, Copy, Check, ExternalLink, X } from "lucide-react";
import { SiX } from "react-icons/si";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
  { value: "professional", label: "Professional", description: "Balanced, credible tone" },
  { value: "authoritative", label: "Authoritative", description: "Expert, decisive voice" },
  { value: "contrarian", label: "Contrarian", description: "Challenge the status quo" },
  { value: "ai-recommended", label: "AI Picks", description: "AI-optimized for engagement" },
];

const samplePosts: Record<string, string> = {
  professional: `I just came across this fascinating development in our industry. Here's what caught my attention and why I think it matters for all of us working in this space.

The key takeaway? We need to stay ahead of these changes and adapt our strategies accordingly.

What are your thoughts on this trend?`,
  authoritative: `Let me break down exactly what this means for the industry.

After 10+ years in this field, I've seen trends come and go. But this one is different.

Here's my analysis:

1. The immediate impact
2. What smart companies are doing
3. The opportunity most are missing

Don't make the mistake of ignoring this shift.`,
  contrarian: `Everyone is celebrating this news. I'm not so sure.

Here's the uncomfortable truth no one is talking about:

While the headlines look great, there's a fundamental problem that's being overlooked.

Unpopular opinion: This might actually hurt more than it helps. Here's why...`,
  "ai-recommended": `This article highlights something I've been thinking about lately.

As professionals in this space, we have a unique perspective on how these changes will play out.

My take: The real opportunity isn't where most people are looking.

What's your read on this?`,
};

export function PostGeneratorModal({ item, isOpen, onClose, onSaveDraft, onPost }: PostGeneratorModalProps) {
  const [platform, setPlatform] = useState<string>("linkedin");
  const [tone, setTone] = useState<string>("professional");
  const [content, setContent] = useState<string>(samplePosts.professional);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
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
      setContent(data.content || samplePosts[selectedTone] || samplePosts.professional);
    } catch (error) {
      console.error("Error generating AI content:", error);
      setContent(samplePosts[selectedTone] || samplePosts.professional);
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    if (isOpen && item) {
      generateAIContent(platform, tone);
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

  const handleCopyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast({
        title: "Added to Clipboard",
        description: "Your post content has been copied and is ready to paste.",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Copy failed",
        description: "Could not copy to clipboard. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handlePostNow = async () => {
    try {
      await navigator.clipboard.writeText(content);
      
      const linkedInUrl = "https://www.linkedin.com/feed/";
      const twitterUrl = "https://twitter.com/compose/tweet";
      
      if (platform === "linkedin") {
        window.open(linkedInUrl, "_blank");
        toast({
          title: "Opening LinkedIn",
          description: "Paste your post in the LinkedIn composer. Content copied to clipboard!",
        });
      } else {
        window.open(twitterUrl, "_blank");
        toast({
          title: "Opening Twitter/X",
          description: "Paste your post in the tweet composer. Content copied to clipboard!",
        });
      }
      
      onPost(platform, tone, content);
    } catch (error) {
      toast({
        title: "Copy failed",
        description: "Could not copy to clipboard. Please copy the content manually.",
        variant: "destructive",
      });
    }
  };

  const characterLimit = platform === "twitter" ? 280 : 3000;
  const characterCount = content.length;

  if (!item) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl p-0 gap-0 overflow-hidden max-h-[90vh]" aria-describedby={undefined}>
        <VisuallyHidden>
          <DialogTitle>Generate Post</DialogTitle>
        </VisuallyHidden>
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
                onClick={() => onSaveDraft(platform, tone, content)}
                data-testid="button-save-draft"
              >
                <Save className="w-4 h-4 mr-2" />
                Save Draft
              </Button>
              <Button 
                className="w-full justify-center"
                onClick={handlePostNow}
                disabled={characterCount > characterLimit}
                data-testid="button-post-now"
              >
                <Send className="w-4 h-4 mr-2" />
                Post Now
              </Button>
            </div>
          </div>
          
          <div className="flex-1 p-6 flex flex-col min-w-0">
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
                        Copy and Paste To LinkedIn
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
                className="flex-1 min-h-[400px] resize-none text-base leading-relaxed"
                placeholder="Your post content..."
                data-testid="textarea-post-content"
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
