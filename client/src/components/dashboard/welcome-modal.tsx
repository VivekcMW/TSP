import { Sparkles, Inbox, PenLine, Send, ArrowRight, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface WelcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const steps = [
  {
    icon: Inbox,
    title: "Curated Content",
    description: "Your inbox is filled with articles matched to your industry and interests.",
  },
  {
    icon: PenLine,
    title: "Generate Posts",
    description: "Click any article to create AI-powered LinkedIn or Twitter posts in your voice.",
  },
  {
    icon: Send,
    title: "Post & Build Authority",
    description: "Copy your post directly to LinkedIn or save drafts for later.",
  },
];

export function WelcomeModal({ isOpen, onClose }: WelcomeModalProps) {
  const { toast } = useToast();

  const updateProgressMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/profile", { hasSeenWelcome: true });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      onClose();
    },
    onError: (error: Error) => {
      console.error("Error updating welcome status:", error);
      toast({
        title: "Connection issue",
        description: "Please try again to continue.",
        variant: "destructive",
      });
      // Don't close on error - let user retry
    },
  });

  const handleGetStarted = () => {
    if (!updateProgressMutation.isPending) {
      updateProgressMutation.mutate();
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && !updateProgressMutation.isPending) {
      handleGetStarted();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden" aria-describedby={undefined}>
        <VisuallyHidden>
          <DialogTitle>Welcome to TheSocialPundit</DialogTitle>
        </VisuallyHidden>
        <div className="relative">
          <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-8 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-6 h-6 text-primary" />
              <span className="text-sm font-medium text-primary">Welcome to TheSocialPundit</span>
            </div>
            <h2 className="text-2xl font-bold mb-2">
              Build Your Professional Authority
            </h2>
            <p className="text-muted-foreground">
              Turn industry news into thought leadership posts in under 5 minutes.
            </p>
          </div>
          
          <Button
            variant="ghost"
            size="icon"
            onClick={handleGetStarted}
            className="absolute top-4 right-4"
            data-testid="button-close-welcome"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          <div className="space-y-4">
            {steps.map((step, index) => (
              <div 
                key={index} 
                className="flex items-start gap-4"
                data-testid={`welcome-step-${index + 1}`}
              >
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <step.icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium mb-0.5">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                </div>
              </div>
            ))}
          </div>

          <Button 
            onClick={handleGetStarted} 
            className="w-full"
            disabled={updateProgressMutation.isPending}
            data-testid="button-get-started"
          >
            Get Started
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
