import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Inbox, Filter, Calendar } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { InboxCard } from "@/components/dashboard/inbox-card";
import { PostGeneratorModal } from "@/components/dashboard/post-generator-modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { InboxItem } from "@shared/schema";

const sampleInboxItems: InboxItem[] = [
  {
    id: "1",
    userId: "user1",
    headline: "OpenAI Announces GPT-5 with Revolutionary Reasoning Capabilities",
    source: "TechCrunch",
    articleUrl: "https://techcrunch.com/example",
    matchedKeywords: ["AI", "Machine Learning", "OpenAI"],
    summary: "The latest model shows significant improvements in logical reasoning and reduces hallucinations by 80%.",
    status: "active",
    createdAt: new Date(),
  },
  {
    id: "2",
    userId: "user1",
    headline: "The Future of Product Management in the Age of AI Assistants",
    source: "Harvard Business Review",
    articleUrl: "https://hbr.org/example",
    matchedKeywords: ["Product Management", "AI", "Leadership"],
    summary: "How product managers are evolving their roles as AI takes over routine tasks.",
    status: "active",
    createdAt: new Date(),
  },
  {
    id: "3",
    userId: "user1",
    headline: "Stripe Launches New Developer Tools for Faster Integration",
    source: "The Verge",
    articleUrl: "https://theverge.com/example",
    matchedKeywords: ["Stripe", "Developer Tools", "Fintech"],
    summary: "New APIs reduce integration time from weeks to hours for common payment flows.",
    status: "active",
    createdAt: new Date(),
  },
  {
    id: "4",
    userId: "user1",
    headline: "Remote Work Revolution: 3 Years Later, What Have We Learned?",
    source: "Forbes",
    articleUrl: "https://forbes.com/example",
    matchedKeywords: ["Remote Work", "Leadership", "Startup Growth"],
    summary: "A comprehensive analysis of how remote-first companies outperformed traditional ones.",
    status: "active",
    createdAt: new Date(),
  },
  {
    id: "5",
    userId: "user1",
    headline: "Linear Raises $50M to Build the Future of Project Management",
    source: "VentureBeat",
    articleUrl: "https://venturebeat.com/example",
    matchedKeywords: ["Linear", "B2B SaaS", "Fundraising"],
    summary: "The company plans to expand into enterprise market with new features.",
    status: "active",
    createdAt: new Date(),
  },
];

type FilterType = "all" | "saved" | "dismissed";

export default function DashboardPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [filter, setFilter] = useState<FilterType>("all");
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data: inboxItems, isLoading } = useQuery<InboxItem[]>({
    queryKey: ["/api/inbox"],
    enabled: !!user,
  });

  const items = inboxItems?.length ? inboxItems : sampleInboxItems;
  const filteredItems = items.filter(item => {
    if (filter === "all") return item.status === "active";
    if (filter === "saved") return item.status === "saved";
    if (filter === "dismissed") return item.status === "dismissed";
    return true;
  });

  const handleGeneratePost = (item: InboxItem) => {
    setSelectedItem(item);
    setIsModalOpen(true);
  };

  const handleSave = (item: InboxItem) => {
    toast({
      title: "Article saved",
      description: "You can find it in your Saved tab.",
    });
  };

  const handleDismiss = (item: InboxItem) => {
    toast({
      title: "Article dismissed",
      description: "We'll learn from this to improve your recommendations.",
    });
  };

  const handleSaveDraft = (platform: string, tone: string, content: string) => {
    setIsModalOpen(false);
    toast({
      title: "Draft saved",
      description: "Find it in your Drafts tab.",
    });
  };

  const handlePost = (platform: string, tone: string, content: string) => {
    setIsModalOpen(false);
    toast({
      title: "Post published!",
      description: `Your ${platform} post is now live.`,
    });
  };

  return (
    <div className="flex-1 overflow-hidden">
      <header className="sticky top-0 z-10 bg-background border-b px-6 py-4">
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
          
          <div className="flex items-center gap-2">
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
      
      <main className="p-6 overflow-y-auto h-[calc(100vh-80px)]">
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
            <p className="text-muted-foreground max-w-md">
              {filter === "all" 
                ? "Your personalized content will appear here. Check back soon!"
                : `No ${filter} articles found.`
              }
            </p>
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
    </div>
  );
}
