import { FileText, Linkedin, Edit, Trash2, Send } from "lucide-react";
import { SiX } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const sampleDrafts = [
  {
    id: "1",
    platform: "linkedin",
    tone: "professional",
    content: "I just came across this fascinating development in our industry. Here's what caught my attention and why I think it matters for all of us working in this space.\n\nThe key takeaway? We need to stay ahead of these changes.",
    createdAt: new Date(Date.now() - 86400000),
    headline: "OpenAI Announces GPT-5",
  },
  {
    id: "2",
    platform: "twitter",
    tone: "contrarian",
    content: "Everyone is celebrating this news. I'm not so sure.\n\nHere's the uncomfortable truth no one is talking about...",
    createdAt: new Date(Date.now() - 172800000),
    headline: "The Future of Product Management",
  },
];

export default function DraftsPage() {
  const { toast } = useToast();

  const handleEdit = (id: string) => {
    toast({
      title: "Opening editor...",
      description: "Draft editing would open here.",
    });
  };

  const handleDelete = (id: string) => {
    toast({
      title: "Draft deleted",
      description: "The draft has been removed.",
    });
  };

  const handlePost = (id: string) => {
    toast({
      title: "Post published!",
      description: "Your post is now live.",
    });
  };

  return (
    <div className="flex-1 overflow-hidden">
      <header className="sticky top-0 z-10 bg-background border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold" data-testid="text-page-title">Drafts</h1>
            <p className="text-sm text-muted-foreground">
              {sampleDrafts.length} drafts saved
            </p>
          </div>
        </div>
      </header>
      
      <main className="p-6 overflow-y-auto h-[calc(100vh-80px)]">
        {sampleDrafts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <FileText className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">No drafts yet</h3>
            <p className="text-muted-foreground max-w-md">
              When you save posts for later, they'll appear here.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 max-w-3xl">
            {sampleDrafts.map((draft) => (
              <Card key={draft.id} className="hover-elevate" data-testid={`card-draft-${draft.id}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="gap-1">
                        {draft.platform === "linkedin" ? (
                          <Linkedin className="w-3 h-3" />
                        ) : (
                          <SiX className="w-3 h-3" />
                        )}
                        {draft.platform}
                      </Badge>
                      <Badge variant="outline" className="capitalize">
                        {draft.tone}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {draft.createdAt.toLocaleDateString()}
                    </span>
                  </div>
                  
                  <p className="text-sm text-muted-foreground mb-2 italic">
                    Based on: {draft.headline}
                  </p>
                  
                  <p className="text-sm leading-relaxed line-clamp-3 mb-4">
                    {draft.content}
                  </p>
                  
                  <div className="flex items-center gap-2 pt-3 border-t">
                    <Button 
                      size="sm" 
                      onClick={() => handlePost(draft.id)}
                      data-testid={`button-post-${draft.id}`}
                    >
                      <Send className="w-3.5 h-3.5 mr-1.5" />
                      Post Now
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => handleEdit(draft.id)}
                      data-testid={`button-edit-${draft.id}`}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => handleDelete(draft.id)}
                      data-testid={`button-delete-${draft.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
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
