import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileText, Linkedin, Edit, Trash2, Send, ExternalLink } from "lucide-react";
import { SiX } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Draft } from "@shared/schema";

export default function DraftsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [editingDraft, setEditingDraft] = useState<Draft | null>(null);
  const [editContent, setEditContent] = useState("");
  const [postingDraft, setPostingDraft] = useState<Draft | null>(null);

  const { data: drafts, isLoading } = useQuery<Draft[]>({
    queryKey: ["/api/drafts"],
    enabled: !!user,
  });

  const updateDraftMutation = useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const res = await apiRequest("PATCH", `/api/drafts/${id}`, { content });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drafts"] });
      toast({
        title: "Draft updated",
        description: "Your changes have been saved.",
      });
      setEditingDraft(null);
    },
    onError: () => {
      toast({
        title: "Failed to update",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteDraftMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/drafts/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drafts"] });
      toast({
        title: "Draft deleted",
        description: "The draft has been removed.",
      });
    },
    onError: () => {
      toast({
        title: "Failed to delete",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleEdit = (draft: Draft) => {
    setEditingDraft(draft);
    setEditContent(draft.content);
  };

  const handleSaveEdit = () => {
    if (editingDraft) {
      updateDraftMutation.mutate({ id: editingDraft.id, content: editContent });
    }
  };

  const handleDelete = (id: string) => {
    deleteDraftMutation.mutate(id);
  };

  const handlePost = (draft: Draft) => {
    setPostingDraft(draft);
  };

  const handleCopyAndPost = (draft: Draft) => {
    navigator.clipboard.writeText(draft.content);
    toast({
      title: "Content copied!",
      description: `Paste it into ${draft.platform === "linkedin" ? "LinkedIn" : "Twitter/X"}.`,
    });
    
    const url = draft.platform === "linkedin" 
      ? "https://www.linkedin.com/feed/" 
      : "https://twitter.com/compose/tweet";
    window.open(url, "_blank");
    setPostingDraft(null);
  };

  const draftsList = drafts || [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="sticky top-0 z-10 bg-background border-b px-6 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold" data-testid="text-page-title">Drafts</h1>
            <p className="text-sm text-muted-foreground">
              {draftsList.length} draft{draftsList.length !== 1 ? "s" : ""} saved
            </p>
          </div>
        </div>
      </header>
      
      <main className="flex-1 p-6 overflow-y-auto">
        {isLoading ? (
          <div className="grid gap-4 max-w-3xl">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-48 w-full rounded-lg" />
            ))}
          </div>
        ) : draftsList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <FileText className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">No drafts yet</h3>
            <p className="text-muted-foreground max-w-md">
              Go to Inbox, select an article, and generate a post. Saved drafts will appear here.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 max-w-3xl">
            {draftsList.map((draft) => (
              <Card key={draft.id} className="overflow-visible" data-testid={`card-draft-${draft.id}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
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
                      {draft.createdAt ? new Date(draft.createdAt).toLocaleDateString() : ""}
                    </span>
                  </div>
                  
                  <p className="text-sm leading-relaxed line-clamp-4 mb-4 whitespace-pre-wrap">
                    {draft.content}
                  </p>
                  
                  <div className="flex items-center gap-2 pt-3 border-t flex-wrap">
                    <Button 
                      size="sm" 
                      onClick={() => handlePost(draft)}
                      data-testid={`button-post-${draft.id}`}
                    >
                      <Send className="w-3.5 h-3.5 mr-1.5" />
                      Post to {draft.platform === "linkedin" ? "LinkedIn" : "Twitter/X"}
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => handleEdit(draft)}
                      data-testid={`button-edit-${draft.id}`}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => handleDelete(draft.id)}
                      disabled={deleteDraftMutation.isPending}
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

      <Dialog open={!!editingDraft} onOpenChange={(open) => !open && setEditingDraft(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Draft</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="min-h-[200px] resize-none"
              placeholder="Your post content..."
              data-testid="textarea-edit-content"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-2">
              <span>{editContent.length} characters</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingDraft(null)} data-testid="button-cancel-edit">
              Cancel
            </Button>
            <Button 
              onClick={handleSaveEdit} 
              disabled={updateDraftMutation.isPending}
              data-testid="button-save-edit"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!postingDraft} onOpenChange={(open) => !open && setPostingDraft(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {postingDraft?.platform === "linkedin" ? (
                <Linkedin className="w-5 h-5 text-[#0077B5]" />
              ) : (
                <SiX className="w-5 h-5" />
              )}
              Post to {postingDraft?.platform === "linkedin" ? "LinkedIn" : "Twitter/X"}
            </DialogTitle>
            <DialogDescription>
              Your content will be copied to the clipboard and {postingDraft?.platform === "linkedin" ? "LinkedIn" : "Twitter/X"} will open in a new tab.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="bg-muted p-4 rounded-md text-sm whitespace-pre-wrap line-clamp-6">
              {postingDraft?.content}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPostingDraft(null)} data-testid="button-cancel-post">
              Cancel
            </Button>
            <Button 
              onClick={() => postingDraft && handleCopyAndPost(postingDraft)}
              data-testid="button-copy-and-post"
            >
              <ExternalLink className="w-4 h-4 mr-1.5" />
              Copy & Open {postingDraft?.platform === "linkedin" ? "LinkedIn" : "Twitter/X"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
