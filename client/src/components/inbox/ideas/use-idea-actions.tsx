import { useComposer } from "@/components/inbox/composer";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { IDEAS_KEY, refreshTopicQueries, updateIdeaState, withIdeaState } from "@/lib/strategy-queries";
import type { IdeasResponse, IdeaState, RankedIdea, TopicIdea } from "@shared/topic-ideas";

const message = (error: unknown) => error instanceof Error && error.message ? error.message : "Try again.";
type ActionableIdea = TopicIdea & { state?: RankedIdea["state"] };

/** Draft this, Save and Not for me (with Undo), shared by the ideas list, the plan and the Plan panel. */
export function useIdeaActions() {
  const composer = useComposer();
  const { toast } = useToast();

  const change = async (idea: ActionableIdea, state: IdeaState | null, index?: number) => {
    const ranked: RankedIdea = { ...idea, state: idea.state ?? null };
    queryClient.setQueriesData<IdeasResponse>({ queryKey: IDEAS_KEY }, cached => cached && withIdeaState(cached, ranked, state, index));
    try { await updateIdeaState(idea, state); return true; }
    catch (error) {
      toast({ title: state === "used" ? "Couldn't mark the idea as drafted" : "Couldn't update the idea", description: message(error), variant: "destructive" });
      return false;
    } finally { void refreshTopicQueries(); }
  };

  return {
    draft(idea: ActionableIdea) {
      const story = idea.sourceStory;
      if (story) composer.openForStory({ id: story.inboxItemId, headline: story.headline, source: story.source, articleUrl: story.url }, false);
      else composer.openBlank(idea.angle);
      if (idea.state !== "used") void change(idea, "used");
    },
    async toggleSave(idea: ActionableIdea) {
      const saving = idea.state !== "saved";
      if (await change(idea, saving ? "saved" : null)) toast({ title: saving ? "Idea saved" : "Removed from saved ideas" });
    },
    async dismiss(idea: ActionableIdea, index?: number) {
      const previous = idea.state ?? null;
      if (!await change(idea, "dismissed")) return;
      toast({
        title: "Idea hidden", description: "You won't see it again.",
        action: <ToastAction altText="Undo" onClick={() => void change(idea, previous, index)}>Undo</ToastAction>,
      });
    },
  };
}
