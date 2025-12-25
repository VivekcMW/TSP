import { ExternalLink, Sparkles, Bookmark, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { InboxItem } from "@shared/schema";

interface InboxCardProps {
  item: InboxItem;
  onGeneratePost: (item: InboxItem) => void;
  onSave: (item: InboxItem) => void;
  onDismiss: (item: InboxItem) => void;
}

export function InboxCard({ item, onGeneratePost, onSave, onDismiss }: InboxCardProps) {
  const matchedKeywords = item.matchedKeywords || [];

  return (
    <Card className="hover-elevate" data-testid={`card-inbox-${item.id}`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-xs">
              {item.source}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "Today"}
            </span>
          </div>
          <a 
            href={item.articleUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground transition-colors"
            data-testid={`link-article-${item.id}`}
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
        
        <h3 className="font-medium text-base leading-snug mb-2 line-clamp-2" data-testid={`text-headline-${item.id}`}>
          {item.headline}
        </h3>
        
        {item.summary && (
          <p className="text-sm text-muted-foreground mb-3 line-clamp-2 italic">
            {item.summary}
          </p>
        )}
        
        {matchedKeywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {matchedKeywords.slice(0, 4).map((keyword, index) => (
              <Badge key={index} variant="outline" className="text-xs font-normal">
                {keyword}
              </Badge>
            ))}
            {matchedKeywords.length > 4 && (
              <Badge variant="outline" className="text-xs font-normal">
                +{matchedKeywords.length - 4} more
              </Badge>
            )}
          </div>
        )}
        
        <div className="flex items-center gap-2 pt-2 border-t">
          <Button 
            size="sm" 
            onClick={() => onGeneratePost(item)}
            data-testid={`button-generate-${item.id}`}
          >
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
            Generate Post
          </Button>
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => onSave(item)}
            data-testid={`button-save-${item.id}`}
          >
            <Bookmark className="w-4 h-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => onDismiss(item)}
            data-testid={`button-dismiss-${item.id}`}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
