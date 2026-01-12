import { CheckCircle2, Circle, Inbox, PenLine, Save, X, Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { UserProfile } from "@shared/schema";

interface GettingStartedChecklistProps {
  profile: UserProfile;
}

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  icon: typeof Inbox;
  completed: boolean;
}

export function GettingStartedChecklist({ profile }: GettingStartedChecklistProps) {
  const { toast } = useToast();

  const dismissMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/profile", { hasDismissedChecklist: true });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
    },
    onError: (error: Error) => {
      console.error("Error dismissing checklist:", error);
      toast({
        title: "Connection issue",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const items: ChecklistItem[] = [
    {
      id: "explored-inbox",
      label: "Explore your inbox",
      description: "Browse curated articles matched to your interests",
      icon: Inbox,
      completed: profile.hasExploredInbox ?? false,
    },
    {
      id: "generated-post",
      label: "Generate your first post",
      description: "Click any article to create an AI-powered post",
      icon: PenLine,
      completed: profile.hasGeneratedPost ?? false,
    },
    {
      id: "saved-draft",
      label: "Save or publish a post",
      description: "Copy to LinkedIn or save as a draft for later",
      icon: Save,
      completed: profile.hasSavedDraft ?? false,
    },
  ];

  const completedCount = items.filter((item) => item.completed).length;
  const progressPercent = (completedCount / items.length) * 100;
  const allComplete = completedCount === items.length;

  if (allComplete) {
    return null;
  }

  return (
    <Card className="mb-6" data-testid="getting-started-checklist">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              Getting Started
              <span className="text-sm font-normal text-muted-foreground">
                {completedCount} of {items.length} complete
              </span>
            </CardTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => dismissMutation.mutate()}
            disabled={dismissMutation.isPending}
            className="shrink-0"
            data-testid="button-dismiss-checklist"
          >
            {dismissMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
          </Button>
        </div>
        <Progress value={progressPercent} className="h-1.5 mt-2" />
      </CardHeader>
      <CardContent className="pb-4">
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className={`flex items-start gap-3 ${item.completed ? "opacity-60" : ""}`}
              data-testid={`checklist-item-${item.id}`}
            >
              {item.completed ? (
                <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
              ) : (
                <Circle className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
              )}
              <div className="min-w-0">
                <p className={`text-sm font-medium ${item.completed ? "line-through" : ""}`}>
                  {item.label}
                </p>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
