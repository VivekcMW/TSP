import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { OnboardingData } from "@/lib/onboarding-choices";

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  industry?: string;
  country?: string;
}

export default function OnboardingPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: user } = useQuery<User>({
    queryKey: ["/api/me"],
  });

  const completeOnboardingMutation = useMutation({
    mutationFn: async (data: OnboardingData) => {
      return await apiRequest("POST", "/api/profile/complete-onboarding", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      toast({
        title: "Preferences saved",
        description: "Create a post now, or add sources and refresh Discover when you're ready.",
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

  return (
    <OnboardingWizard 
      onComplete={handleComplete} 
      isPending={completeOnboardingMutation.isPending}
      userIndustry={user?.industry}
      userCountry={user?.country}
    />
  );
}
