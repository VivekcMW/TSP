import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Inbox, RefreshCw, Link2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { InboxCard } from "@/components/dashboard/inbox-card";
import { PostGeneratorModal } from "@/components/dashboard/post-generator-modal";
import { InstantReviewModal } from "@/components/dashboard/instant-review-modal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { InboxItem } from "@shared/schema";

type FilterType = "all" | "saved" | "dismissed";

export default function DashboardPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [filter, setFilter] = useState<FilterType>("all");
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isInstantReviewOpen, setIsInstantReviewOpen] = useState(false);

  const { data: inboxItems, isLoading } = useQuery<InboxItem[]>({
    queryKey: ["/api/inbox"],
    enabled: !!user,
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/inbox/refresh");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      toast({
        title: "Inbox refreshed",
        description: `Found ${data.count} new articles based on your keywords.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to refresh",
        description: error.message || "Could not fetch new articles. Please try again.",
        variant: "destructive",
      });
    },
  });

  const saveDraftMutation = useMutation({
    mutationFn: async (data: { inboxItemId?: string; platform: string; tone: string; content: string }) => {
      const res = await apiRequest("POST", "/api/drafts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drafts"] });
      toast({
        title: "Draft saved",
        description: "Find it in your Drafts tab.",
      });
    },
    onError: () => {
      toast({
        title: "Failed to save draft",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const items = inboxItems || [];
  const filteredItems = items.filter(item => {
    if (filter === "all") return item.status === "active";
    if (filter === "saved") return item.status === "saved";
    if (filter === "dismissed") return item.status === "dismissed";
    return true;
  });

  const updateInboxItemMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/inbox/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
    },
    onError: () => {
      toast({
        title: "Failed to update",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleGeneratePost = (item: InboxItem) => {
    setSelectedItem(item);
    setIsModalOpen(true);
  };

  const handleSave = (item: InboxItem) => {
    updateInboxItemMutation.mutate({ id: item.id, status: "saved" });
    toast({
      title: "Article saved",
      description: "You can find it in your Saved tab.",
    });
  };

  const handleDismiss = (item: InboxItem) => {
    updateInboxItemMutation.mutate({ id: item.id, status: "dismissed" });
    toast({
      title: "Article dismissed",
      description: "We'll learn from this to improve your recommendations.",
    });
  };

  const handleSaveDraft = (platform: string, tone: string, content: string) => {
    saveDraftMutation.mutate({
      inboxItemId: selectedItem?.id,
      platform,
      tone,
      content,
    });
    setIsModalOpen(false);
  };

  const handlePost = (platform: string, tone: string, content: string) => {
    saveDraftMutation.mutate({
      inboxItemId: selectedItem?.id,
      platform,
      tone,
      content,
    });
    setIsModalOpen(false);
    toast({
      title: "Draft created",
      description: `Go to Drafts to connect your ${platform === "linkedin" ? "LinkedIn" : "Twitter/X"} account and post.`,
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="flex-shrink-0 bg-background border-b px-6 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
              <Inbox className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold" data-testid="text-page-title">Your Inbox</h1>
              <p className="text-sm text-muted-foreground">
                {filteredItems.length} articles curated for you today
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => setIsInstantReviewOpen(true)}
              data-testid="button-instant-review"
            >
              <Link2 className="w-4 h-4 mr-2" />
              Instant Review
            </Button>
            <Button
              variant="default"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              data-testid="button-refresh-inbox"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
              {refreshMutation.isPending ? "Searching..." : "Refresh Articles"}
            </Button>
            <div className="flex bg-muted rounded-md p-1">
              {(["all", "saved", "dismissed"] as FilterType[]).map((f) => (
                <Button
                  key={f}
                  variant={filter === f ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setFilter(f)}
                  className="capitalize"
                  data-testid={`button-filter-${f}`}
                >
                  {f}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </header>
      
      <main className="flex-1 p-6 overflow-y-auto">
        {isLoading ? (
          <div className="grid gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-48 w-full rounded-lg" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Inbox className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">No articles yet</h3>
            <p className="text-muted-foreground max-w-md mb-4">
              {filter === "all" 
                ? "Click 'Refresh Articles' to search for content based on your keywords and interests."
                : `No ${filter} articles found.`
              }
            </p>
            {filter === "all" && (
              <Button
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
                data-testid="button-refresh-empty"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
                {refreshMutation.isPending ? "Searching..." : "Refresh Articles"}
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 max-w-3xl">
            {filteredItems.map((item) => (
              <InboxCard
                key={item.id}
                item={item}
                onGeneratePost={handleGeneratePost}
                onSave={handleSave}
                onDismiss={handleDismiss}
              />
            ))}
          </div>
        )}
      </main>
      
      <PostGeneratorModal
        item={selectedItem}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSaveDraft={handleSaveDraft}
        onPost={handlePost}
      />
      
      <InstantReviewModal
        isOpen={isInstantReviewOpen}
        onClose={() => setIsInstantReviewOpen(false)}
      />
    </div>
  );
}
