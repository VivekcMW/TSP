import { useState, useEffect } from "react";
import { Linkedin, RefreshCw, Send, Save } from "lucide-react";
import { SiX } from "react-icons/si";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
  { value: "professional", label: "Professional" },
  { value: "authoritative", label: "Authoritative" },
  { value: "contrarian", label: "Contrarian" },
  { value: "ai-recommended", label: "AI Picks" },
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
    }
  }, [isOpen, item?.id]);

  const handleToneChange = (newTone: string) => {
    if (newTone) {
      setTone(newTone);
      generateAIContent(platform, newTone);
    }
  };

  const handleRegenerate = () => {
    generateAIContent(platform, tone);
  };

  const characterLimit = platform === "twitter" ? 280 : 3000;
  const characterCount = content.length;

  if (!item) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Generate Post</DialogTitle>
          <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
            Based on: {item.headline}
          </p>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          <div className="space-y-3">
            <Label>Platform</Label>
            <ToggleGroup 
              type="single" 
              value={platform} 
              onValueChange={(v) => v && setPlatform(v)}
              className="justify-start"
            >
              <ToggleGroupItem value="linkedin" data-testid="toggle-linkedin">
                <Linkedin className="w-4 h-4 mr-2" />
                LinkedIn
              </ToggleGroupItem>
              <ToggleGroupItem value="twitter" data-testid="toggle-twitter">
                <SiX className="w-4 h-4 mr-2" />
                Twitter/X
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          
          <div className="space-y-3">
            <Label>Tone</Label>
            <ToggleGroup 
              type="single" 
              value={tone} 
              onValueChange={handleToneChange}
              className="justify-start flex-wrap"
            >
              {tones.map((t) => (
                <ToggleGroupItem 
                  key={t.value} 
                  value={t.value}
                  data-testid={`toggle-tone-${t.value}`}
                >
                  {t.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Your Post</Label>
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
            </div>
            <Textarea 
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[200px] resize-none"
              placeholder="Your post content..."
              data-testid="textarea-post-content"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{characterCount} / {characterLimit} characters</span>
              {characterCount > characterLimit && (
                <span className="text-destructive">Exceeds limit</span>
              )}
            </div>
          </div>
        </div>
        
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} data-testid="button-cancel">
            Cancel
          </Button>
          <Button 
            variant="secondary" 
            onClick={() => onSaveDraft(platform, tone, content)}
            data-testid="button-save-draft"
          >
            <Save className="w-4 h-4 mr-1.5" />
            Save Draft
          </Button>
          <Button 
            onClick={() => onPost(platform, tone, content)}
            disabled={characterCount > characterLimit}
            data-testid="button-post-now"
          >
            <Send className="w-4 h-4 mr-1.5" />
            Post Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
