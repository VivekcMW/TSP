import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface OnboardingData {
  focusDescription: string;
  publications: string[];
  keywords: string[];
  influencers: string[];
  companies: string[];
}

export default function OnboardingPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const completeOnboardingMutation = useMutation({
    mutationFn: async (data: OnboardingData) => {
      return await apiRequest("POST", "/api/profile/complete-onboarding", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      toast({
        title: "Profile created!",
        description: "Your personalized content inbox is ready.",
      });
      setLocation("/dashboard");
    },
    onError: () => {
      toast({
        title: "Something went wrong",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleComplete = (data: OnboardingData) => {
    completeOnboardingMutation.mutate(data);
  };

  return <OnboardingWizard onComplete={handleComplete} />;
}
