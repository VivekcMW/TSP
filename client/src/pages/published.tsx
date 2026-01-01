import { Send, Linkedin, ExternalLink, Heart, MessageCircle, Repeat2 } from "lucide-react";
import { SiX } from "react-icons/si";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const samplePublished = [
  {
    id: "1",
    platform: "linkedin",
    content: "I just came across this fascinating development in our industry. Here's what caught my attention and why I think it matters for all of us working in this space.\n\nThe key takeaway? We need to stay ahead of these changes and adapt our strategies accordingly.",
    publishedAt: new Date(Date.now() - 86400000),
    likes: 42,
    comments: 8,
    shares: 5,
  },
  {
    id: "2",
    platform: "twitter",
    content: "Everyone is celebrating this news. I'm not so sure.\n\nHere's the uncomfortable truth no one is talking about...",
    publishedAt: new Date(Date.now() - 172800000),
    likes: 156,
    comments: 23,
    shares: 34,
  },
];

export default function PublishedPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="sticky top-0 z-10 bg-background border-b px-6 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
            <Send className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold" data-testid="text-page-title">Published</h1>
            <p className="text-sm text-muted-foreground">
              {samplePublished.length} posts published
            </p>
          </div>
        </div>
      </header>
      
      <main className="flex-1 p-6 overflow-y-auto">
        {samplePublished.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Send className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">No published posts yet</h3>
            <p className="text-muted-foreground max-w-md">
              When you publish posts, they'll appear here with their engagement metrics.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 max-w-3xl">
            {samplePublished.map((post) => (
              <Card key={post.id} className="hover-elevate" data-testid={`card-published-${post.id}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="gap-1">
                        {post.platform === "linkedin" ? (
                          <Linkedin className="w-3 h-3" />
                        ) : (
                          <SiX className="w-3 h-3" />
                        )}
                        {post.platform}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {post.publishedAt.toLocaleDateString()}
                      </span>
                      <a 
                        href="#" 
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        data-testid={`link-view-${post.id}`}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  </div>
                  
                  <p className="text-sm leading-relaxed whitespace-pre-line mb-4">
                    {post.content}
                  </p>
                  
                  <div className="flex items-center gap-6 pt-3 border-t text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Heart className="w-4 h-4" />
                      <span>{post.likes}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <MessageCircle className="w-4 h-4" />
                      <span>{post.comments}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Repeat2 className="w-4 h-4" />
                      <span>{post.shares}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
